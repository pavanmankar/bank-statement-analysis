import { parseIndianAmount, toIsoDate } from "../money.js";

export interface AmountCells {
  refNo: string | null;
  debit: string | null;
  credit: string | null;
  balance: string;
  unsigned?: string | null;
  valueDate?: string | null;
}

const AMOUNT = String.raw`(?:\d{1,3}(?:,\d{2})*,\d{3}|\d+)\.\d{2}`;
const AMOUNT_PATTERN = new RegExp(AMOUNT, "g");
const SIGNED_AMOUNT_PATTERN = new RegExp(`-?${AMOUNT}`, "g");

export function isAmountLine(line: string): boolean {
  return parseAnyAmounts(line) !== null;
}

export function parseAnyAmounts(line: string): AmountCells | null {
  return parseAmountLine(line) ?? parseGluedDateAmounts(line) ?? parseTabularAmounts(line);
}

export function parseAmountLine(line: string): AmountCells | null {
  const text = line.replace(/\s+/g, "");
  if (text.includes("/") || !new RegExp(AMOUNT).test(text)) return null;

  let refNo: string | null = null;
  let body = text;
  const refMatch = /^(\d+)-(.+)$/.exec(text);
  if (refMatch?.[1] && refMatch[2] && extractAmounts(refMatch[2]).length >= 2) {
    refNo = refMatch[1];
    body = refMatch[2];
  }

  let kind: "debit" | "credit";
  if (body.startsWith("--")) {
    kind = "credit";
    body = body.slice(2);
  } else if (body.startsWith("-")) {
    kind = "debit";
    body = body.slice(1);
  } else if (refNo && body.includes("-")) {
    kind = "debit";
  } else if (refNo) {
    kind = "credit";
  } else {
    return null;
  }

  const amounts = extractAmounts(body);
  if (amounts.length !== 2 || !amounts[0] || !amounts[1]) return null;
  const joined = kind === "debit" ? `${amounts[0]}-${amounts[1]}` : `${amounts[0]}${amounts[1]}`;
  if (body.replace(/-/g, "") !== joined.replace(/-/g, "")) return null;

  if (kind === "debit") {
    return { refNo, debit: parseIndianAmount(amounts[0]), credit: null, balance: parseIndianAmount(amounts[1]) };
  }
  return { refNo, debit: null, credit: parseIndianAmount(amounts[0]), balance: parseIndianAmount(amounts[1]) };
}

export function stripAmountTokens(text: string): string {
  return text
    .replace(AMOUNT_PATTERN, " ")
    .replace(/\b(CR|DR)\b/gi, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function parseGluedDateAmounts(line: string): AmountCells | null {
  const dateRe = /(\d{2}[/-]\d{2}[/-]\d{2})(?=[\d,]+\.\d{2})/g;
  let chosen: { date: string; after: string; before: string } | null = null;
  for (const matched of line.matchAll(dateRe)) {
    const raw = matched[1];
    const index = matched.index ?? 0;
    if (!raw) continue;
    const after = line.slice(index + matched[0].length);
    const amounts = extractSignedAmounts(after);
    if (amounts.length < 2 || after.replace(/\s+/g, "") !== amounts.join("")) continue;
    chosen = { date: raw, after, before: line.slice(0, index) };
  }
  if (!chosen) return null;

  const cells = cellsFromTrailingAmounts(extractSignedAmounts(chosen.after), `${chosen.before} ${chosen.after}`);
  if (!cells) return null;
  const refMatch = /([A-Z]{2,}\d{6,}|\d{12,18})$/i.exec(chosen.before.replace(/\s+/g, ""));
  try {
    return { ...cells, refNo: refMatch?.[1] ?? cells.refNo, valueDate: toIsoDate(chosen.date) };
  } catch {
    return { ...cells, refNo: refMatch?.[1] ?? cells.refNo };
  }
}

function parseTabularAmounts(line: string): AmountCells | null {
  if (!isTrailingAmountLine(line)) return null;
  return cellsFromTrailingAmounts(extractAmounts(line), line);
}

function cellsFromTrailingAmounts(amounts: string[], hintText: string): AmountCells | null {
  if (amounts.length < 2 || !amounts.at(-1)) return null;
  const balance = parseIndianAmount(amounts.at(-1) ?? "");
  if (amounts.length >= 3) {
    const debitRaw = amounts.at(-3) ?? "0.00";
    const creditRaw = amounts.at(-2) ?? "0.00";
    const debit = isZero(debitRaw) ? null : parseIndianAmount(debitRaw);
    const credit = isZero(creditRaw) ? null : parseIndianAmount(creditRaw);
    if (!debit && !credit) return null;
    return { refNo: null, debit, credit, balance };
  }

  const txn = parseIndianAmount(amounts[0] ?? "");
  const side = hintSide(hintText);
  if (side === "debit") return { refNo: null, debit: txn, credit: null, balance };
  if (side === "credit") return { refNo: null, debit: null, credit: txn, balance };
  return { refNo: null, debit: null, credit: null, balance, unsigned: txn };
}

function isTrailingAmountLine(line: string): boolean {
  const amounts = extractAmounts(line);
  if (amounts.length < 2) return false;
  const last = amounts.at(-1);
  if (!last) return false;
  const index = line.lastIndexOf(last);
  const after = line
    .slice(index + last.length)
    .replace(/\s*(CR|DR)\.?/gi, "")
    .trim();
  return after.length === 0;
}

function hintSide(line: string): "debit" | "credit" | null {
  if (/\b(?:UPI|IMPS|NEFT|IFT)[-/ ]CR\b/i.test(line)) return "credit";
  if (/\b(?:UPI|IMPS|NEFT|IFT)[-/ ]DR\b/i.test(line)) return "debit";
  const tagged = new RegExp(`(?:${AMOUNT})\\s*(CR|DR)\\b`, "i").exec(line);
  if (tagged?.[1]) return tagged[1].toUpperCase() === "CR" ? "credit" : "debit";
  if (/^\s*--/.test(line)) return "credit";
  if (/^\s*-/.test(line)) return "debit";
  if (/^\s*(WDL|WD|WITHDRAWAL)\b/i.test(line)) return "debit";
  if (/^\s*(DEP|DEPOSIT)\b/i.test(line)) return "credit";
  return null;
}

function isZero(raw: string): boolean {
  return parseIndianAmount(raw) === "0.00";
}

function extractAmounts(text: string): string[] {
  return text.match(AMOUNT_PATTERN) ?? [];
}

function extractSignedAmounts(text: string): string[] {
  return text.match(SIGNED_AMOUNT_PATTERN) ?? [];
}
