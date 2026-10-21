import { parseIndianAmount, toIsoDate } from "../money.js";
import type { StatementLine } from "../types.js";

const HEADER = ["txn_date", "value_date", "description", "ref_no", "debit", "credit", "balance"];

export function parseCsv(text: string): StatementLine[] {
  const rows = splitCsv(text).filter((row) => row.some((cell) => cell.trim().length > 0));
  const header = rows[0]?.map((cell) => cell.trim().toLowerCase());
  if (!header || HEADER.some((column, index) => header[index] !== column)) {
    throw new Error(`CSV header must be ${HEADER.join(",")}`);
  }

  return rows.slice(1).map((row, index) => {
    const cell = (position: number): string => (row[position] ?? "").trim();
    const debit = cell(4);
    const credit = cell(5);
    if ((debit.length === 0 && credit.length === 0) || (debit.length > 0 && credit.length > 0)) {
      throw new Error(`Row ${index + 2} must have either a debit or a credit`);
    }
    return {
      txnDate: toIsoDate(cell(0)),
      valueDate: toIsoDate(cell(1)),
      description: cell(2),
      refNo: cell(3).length > 0 ? cell(3) : null,
      debit: debit.length > 0 ? parseIndianAmount(debit) : null,
      credit: credit.length > 0 ? parseIndianAmount(credit) : null,
      balance: parseIndianAmount(cell(6)),
    };
  });
}

function splitCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let cell = "";
  let quoted = false;

  for (let index = 0; index < text.length; index += 1) {
    const char = text[index];
    if (quoted) {
      if (char === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
        }
      } else {
        cell += char;
      }
      continue;
    }
    if (char === '"') {
      quoted = true;
      continue;
    }
    if (char === ",") {
      row.push(cell);
      cell = "";
      continue;
    }
    if (char === "\n" || char === "\r") {
      if (char === "\r" && text[index + 1] === "\n") index += 1;
      row.push(cell);
      rows.push(row);
      row = [];
      cell = "";
      continue;
    }
    cell += char;
  }
  if (cell.length > 0 || row.length > 0) {
    row.push(cell);
    rows.push(row);
  }
  return rows;
}
