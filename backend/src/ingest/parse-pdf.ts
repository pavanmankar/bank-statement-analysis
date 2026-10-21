import { consumeLeadingDates } from "../money.js";
import type { StatementLine, StatementSummary } from "../types.js";
import { toPaise } from "./balance-chain.js";
import { parseAnyAmounts, stripAmountTokens } from "./parse-amount.js";

interface DraftLine extends StatementLine {
  unsigned?: string | null;
}

export function parseStatementText(text: string): { lines: StatementLine[]; summary: StatementSummary | null } {
  const rawLines = text
    .split(/\r?\n/)
    .map((line) => line.replace(/\u00a0/g, " ").replace(/[\u2212\u2013\u2014]/g, "-").trim())
    .filter((line) => line.length > 0);
  const drafts: DraftLine[] = [];
  let index = 0;

  while (index < rawLines.length) {
    const current = rawLines[index] ?? "";
    if (drafts.length > 0 && isSummaryHeading(current)) break;
    const dates = consumeLeadingDates(current);
    if (!dates) {
      index += 1;
      continue;
    }
    if (isSkipRest(dates.rest) && !parseAnyAmounts(dates.rest)) {
      index += 1;
      continue;
    }

    let amounts = parseAnyAmounts(dates.rest);
    const descriptionParts: string[] = [];
    if (dates.rest) {
      const description = amounts ? stripAmountTokens(dates.rest) : dates.rest;
      if (description && !isPageFurniture(description) && !isSkipRest(description)) {
        descriptionParts.push(cleanNarration(description));
      }
    }
    index += 1;

    if (!amounts) {
      let scanned = 0;
      while (index < rawLines.length && scanned < 40) {
        const next = rawLines[index] ?? "";
        if (isSummaryHeading(next) || consumeLeadingDates(next)) break;
        const parsed = parseAnyAmounts(next);
        if (parsed) {
          amounts = parsed;
          index += 1;
          break;
        }
        if (!isPageFurniture(next)) {
          descriptionParts.push(next);
        }
        index += 1;
        scanned += 1;
      }
    }

    const description = descriptionParts.join(" ").trim();
    if (!amounts || isJunkNarration(description)) continue;
    drafts.push({
      txnDate: dates.txnDate,
      valueDate: amounts.valueDate ?? dates.valueDate,
      description,
      refNo: amounts.refNo,
      debit: amounts.debit,
      credit: amounts.credit,
      balance: amounts.balance,
      unsigned: amounts.unsigned ?? null,
    });
  }

  return { lines: applyBalanceSides(drafts), summary: parseSummary(rawLines.slice(index).join("\n")) };
}

export function pdfFailureMessage(error: unknown): string | null {
  const name = error instanceof Error ? error.name : "";
  const message = error instanceof Error ? error.message : String(error);
  if (/password/i.test(`${name} ${message}`)) {
    return "This PDF is password protected. Remove the password and upload it again.";
  }
  return null;
}

export function assertPdfHasText(text: string): void {
  if (text.replace(/\s/g, "").length < 40) {
    throw new Error(
      "This PDF has no readable text. It looks scanned. Download the statement again from the bank as a text PDF or CSV.",
    );
  }
}

export const UNSUPPORTED_LAYOUT = "No transactions were found. This statement layout is not supported yet.";

export function assertSummary(lines: StatementLine[], summary: StatementSummary | null): void {
  if (!summary) return;
  const debitCount = lines.filter((line) => line.debit !== null).length;
  const creditCount = lines.filter((line) => line.credit !== null).length;
  const closing = lines.at(-1)?.balance;
  const hasCounts =
    summary.debitCount !== null || summary.creditCount !== null || summary.countToken !== null;
  const countsMatch =
    !hasCounts ||
    (summary.debitCount === debitCount && summary.creditCount === creditCount) ||
    summary.countToken === `${debitCount}${creditCount}`;
  if (!countsMatch) {
    throw new Error(
      `Statement summary does not match parsed rows. Summary counts ${summary.countToken ?? `${summary.debitCount}/${summary.creditCount}`}, parsed ${debitCount} debits and ${creditCount} credits.`,
    );
  }
  if (closing !== summary.closingBalance) {
    throw new Error(
      `Closing balance does not match. Summary ${summary.closingBalance}, last row ${closing ?? "missing"}.`,
    );
  }
}

function applyBalanceSides(lines: DraftLine[]): StatementLine[] {
  const balances = lines.map((line) => toPaise(line.balance));
  return lines.map((line, index) => {
    if (!line.unsigned) {
      const { unsigned: _unsigned, ...rest } = line;
      return rest;
    }
    const amount = toPaise(line.unsigned);
    const current = balances[index];
    const previous = index > 0 ? balances[index - 1] : null;
    const next = index < lines.length - 1 ? balances[index + 1] : null;
    let side: "debit" | "credit" | null = null;
    if (previous !== null && current !== undefined) {
      if (previous + amount === current) side = "credit";
      else if (previous - amount === current) side = "debit";
    }
    if (side === null && next !== null && current !== undefined) {
      if (next + amount === current) side = "credit";
      else if (next - amount === current) side = "debit";
    }
    const { unsigned: _unsigned, ...rest } = line;
    if (side === "credit") return { ...rest, debit: null, credit: line.unsigned };
    return { ...rest, debit: line.unsigned, credit: null };
  });
}

function parseSummary(text: string): StatementSummary | null {
  const start = text.search(/(statement|account|transaction)\s+summary/i);
  if (start < 0) return null;
  const tail = text.slice(start);
  const spaced = /([\d,]+\.\d{2})\s*CR\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s+([\d,]+\.\d{2})\s*CR\s+(\d+)\s+(\d+)/.exec(
    tail,
  );
  if (spaced?.[4] && spaced[5] && spaced[6]) {
    return {
      closingBalance: spaced[4].replace(/,/g, ""),
      debitCount: Number(spaced[5]),
      creditCount: Number(spaced[6]),
      countToken: `${spaced[5]}${spaced[6]}`,
    };
  }
  const compact = /([\d,]+\.\d{2})\s*CR\s*([\d,]+\.\d{2})\s*([\d,]+\.\d{2})\s*([\d,]+\.\d{2})\s*CR\s*(\d+)/.exec(tail);
  if (compact?.[4] && compact[5]) {
    return {
      closingBalance: compact[4].replace(/,/g, ""),
      debitCount: null,
      creditCount: null,
      countToken: compact[5],
    };
  }
  return labeledSummary(tail);
}

function labeledSummary(tail: string): StatementSummary | null {
  const heading = /closing(?:\s+bal(?:ance)?)?/i.exec(tail);
  if (!heading) return null;
  const after = tail.slice(heading.index + heading[0].length);
  const firstLine = after.split(/\r?\n/).map((line) => line.trim()).find((line) => line.length > 0) ?? "";
  const amounts = firstLine.match(/(?:\d{1,3}(?:,\d{2})*,\d{3}|\d+)\.\d{2}/g) ?? [];
  const closingRaw = amounts.at(-1);
  if (!closingRaw) return null;
  const block = tail.replace(/\s+/g, " ");
  const debits = /(?:no\.?\s*of\s*)?debits?[^\d]{0,12}(\d{1,5})/i.exec(block);
  const credits = /(?:no\.?\s*of\s*)?credits?[^\d]{0,12}(\d{1,5})/i.exec(block);
  const countsSafe = amounts.length <= 2;
  return {
    closingBalance: closingRaw.replace(/,/g, ""),
    debitCount: countsSafe && debits ? Number(debits[1]) : null,
    creditCount: countsSafe && credits ? Number(credits[1]) : null,
    countToken: countsSafe && debits && credits ? `${debits[1]}${credits[1]}` : null,
  };
}

function isSummaryHeading(line: string): boolean {
  return /^(statement|account|transaction)\s+summary\b/i.test(line) || /^end of statement\b/i.test(line);
}

function isSkipRest(text: string): boolean {
  return /^(to|through|-)\s+/i.test(text) || /^(date|particulars|narration|description|value\s*date)\b/i.test(text);
}

function isJunkNarration(text: string): boolean {
  return /opening\s+balance|closing\s+balance|brought\s+forward|carried\s+forward|\bb\/f\b|\bc\/f\b/i.test(text);
}

function isPageFurniture(line: string): boolean {
  return (
    /^--\s*\d+\s+of\s+\d+\s+--$/i.test(line) ||
    /^page\s*no/i.test(line) ||
    /^balance$/i.test(line) ||
    /^statement of account$/i.test(line) ||
    /^joint holders/i.test(line) ||
    /^nomination/i.test(line) ||
    /^(account branch|address|city|state|phone no|email|cust id|account no|account type|account status|branch code|currency|od limit|a\/c open)/i.test(
      line,
    ) ||
    /^from\s*:/i.test(line) ||
    /^rtgs\/neft/i.test(line) ||
    /\bbank\s+(limited|ltd)\b/i.test(line) ||
    /^(ifsc|micr|gstin|cin)\b/i.test(line) ||
    /^registered office/i.test(line) ||
    /^contents of this statement/i.test(line) ||
    /^\*closing balance includes/i.test(line) ||
    /^state account branch gstn/i.test(line) ||
    /^generated on/i.test(line) ||
    /^this is a computer generated/i.test(line) ||
    /^date\s*narration/i.test(line) ||
    /^(txn date|transaction date|value date|particulars|withdrawals?|deposits?)\b/i.test(line) ||
    /^does\s*not require signature/i.test(line) ||
    /^[\s.]+$/i.test(line)
  );
}

function cleanNarration(text: string): string {
  return text
    .replace(/\d{1,2}\/\d{1,2}\/\d{2,4}\s*$/g, "")
    .replace(/\s+/g, " ")
    .trim();
}
