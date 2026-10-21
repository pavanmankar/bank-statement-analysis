import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { enrich } from "../ingest/enrich.js";
import { writeExpected } from "./expected.js";
import type { StatementLine } from "../types.js";

interface Draft {
  month: number;
  day: number;
  description: string;
  debitPaise: number | null;
  creditPaise: number | null;
  refNo: string | null;
}

const root = path.resolve(__dirname, "../../..");

function paise(rupees: number): number {
  return Math.round(rupees * 100);
}

function money(value: number): string {
  const abs = Math.abs(value);
  const whole = Math.floor(abs / 100);
  const fraction = String(abs % 100).padStart(2, "0");
  return `${value < 0 ? "-" : ""}${whole}.${fraction}`;
}

function iso(month: number, day: number): string {
  return `2025-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function draft(
  month: number,
  day: number,
  description: string,
  debitRupees: number | null,
  creditRupees: number | null,
  refNo: string | null = null,
): Draft {
  return {
    month,
    day,
    description,
    debitPaise: debitRupees === null ? null : paise(debitRupees),
    creditPaise: creditRupees === null ? null : paise(creditRupees),
    refNo,
  };
}

function filler(month: number, day: number, slot: number): Draft {
  const choices = [
    ["UPI/DR/8100/Meesho/HDFC/meesho/Pay", 180],
    ["UPI/DR/8200/Uber/HDFC/uber/Pay", 220],
    ["UPI/DR/8300/Electricity/HDFC/bill/Pay", 499],
    ["UPI/DR/8400/Bookshop/HDFC/books/Pay", 90],
  ] as const;
  const picked = choices[(month + day + slot) % choices.length] ?? choices[0];
  return draft(month, day, `${picked[0]}-${month}-${day}-${slot}`, picked[1] + (day % 5) * 10, null, null);
}

function buildDrafts(): Draft[] {
  const rows: Draft[] = [];
  for (let month = 1; month <= 9; month += 1) {
    const monthRows: Draft[] = [
      draft(month, 1, "NEFT*SALARY*EMPLOYER", null, 50000, `SAL${month}`),
      draft(month, 1, "UPI/DR/9001/SELFTRANSFER/HDFC/self/Pay", 10000, null),
      draft(month, 2, "UPI/DR/9002/Airtel/UTIB/AIRTELPRED/Pay", 599, null),
      draft(month, 5, "UPI/DR/9005/Swiggy/HDFC/swiggy/Pay", 400, null),
      draft(month, 8, "UPI/DR/9008/DMart/HDFC/dmart/Pay", 2000, null),
      draft(month, 11, "UPI/DR/9011/Netflix/HDFC/netflixupi/Mont", 199, null),
      draft(month, 14, "UPI/DR/9014/Zomato/HDFC/zomato/Pay", 350, null),
      draft(month, 18, "UPI/DR/9018/Blinkit/YESB/blinkit/Pay", 350, null),
      draft(month, 20, "UPI/DR/9020/Flipkart/UTIB/fk/Pay", 800, null),
      draft(month, 22, "ATM WDL ATM CASH", 3000, null),
      draft(month, 24, "UPI/DR/9024/Cafe/HDFC/cafe/Pay", 250, null),
      draft(month, 27, "UPI/DR/9027/Amazon/HDFC/amazon/Pay", 600, null),
    ];
    if (month % 2 === 0) monthRows.push(draft(month, 6, "UPI/DR/9006/Groww/HDFC/groww/Paid", 5000, null));
    else monthRows.push(draft(month, 12, "UPI/DR/9012/Redbus/UTIB/redbus/Pay", 1200, null));
    if (month % 3 === 0) monthRows.push(draft(month, 25, "INTEREST CREDIT", null, 250));
    if (month === 3) monthRows.push(draft(month, 16, "UPI/CR/9016/Flipkart/YESB/flipkart/Refu", null, 800));
    if (month === 5) monthRows.push(draft(month, 19, "DEBIT ATMCard AMC", 236, null));

    const used = new Set(monthRows.map((row) => row.day));
    for (let day = 1; day <= 28; day += 1) {
      monthRows.push(filler(month, day, 1));
      if (!used.has(day)) monthRows.push(filler(month, day, 2));
    }
    rows.push(...monthRows);
  }
  return rows.sort((a, b) => a.month - b.month || a.day - b.day || a.description.localeCompare(b.description));
}

function toLines(drafts: Draft[]): StatementLine[] {
  let balance = paise(200000);
  return drafts.map((row) => {
    if (row.debitPaise !== null) balance -= row.debitPaise;
    if (row.creditPaise !== null) balance += row.creditPaise;
    const date = iso(row.month, row.day);
    return {
      txnDate: date,
      valueDate: date,
      description: row.description,
      refNo: row.refNo,
      debit: row.debitPaise === null ? null : money(row.debitPaise),
      credit: row.creditPaise === null ? null : money(row.creditPaise),
      balance: money(balance),
    };
  });
}

function csvEscape(value: string): string {
  if (/[",\n]/.test(value)) return `"${value.replace(/"/g, '""')}"`;
  return value;
}

function main(): void {
  const lines = toLines(buildDrafts()).map((line) => enrich(line));
  if (lines.length < 500) {
    throw new Error(`Seed has only ${lines.length} rows`);
  }
  const header = "txn_date,value_date,description,ref_no,debit,credit,balance";
  const body = lines
    .map((line) =>
      [line.txnDate, line.valueDate, csvEscape(line.description), line.refNo ?? "", line.debit ?? "", line.credit ?? "", line.balance].join(
        ",",
      ),
    )
    .join("\n");
  const seedDir = path.join(root, "db", "seed");
  mkdirSync(seedDir, { recursive: true });
  writeFileSync(path.join(seedDir, "transactions.csv"), `${header}\n${body}\n`, "utf8");
  writeExpected(lines);
  process.stdout.write(`Wrote ${lines.length} transactions. Latest ${lines.at(-1)?.txnDate ?? ""}.\n`);
}

main();
