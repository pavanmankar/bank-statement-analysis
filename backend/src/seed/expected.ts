import { mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fiscalContext, fiscalQuarter } from "../chat/fiscal.js";
import { isExpense, isReceipt } from "../measures.js";
import type { EnrichedLine } from "../types.js";

export interface ExpectedFile {
  rowCount: number;
  latestDate: string;
  eatingOutLastMonth: number;
  groceryThisQuarter: number;
  groceryLastQuarter: number;
  topMerchants: Array<[string, number]>;
  topMonth: string;
  topMonthTotal: number;
  topMonthMerchant: string;
  above5000Last30: number;
  julyFood: number;
  earned: number;
  growwCount: number;
  growwExpense: number;
  refundInExpenses: number;
  lastQuarterStart: string;
  lastQuarterEnd: string;
  thisQuarterStart: string;
  thisQuarterEnd: string;
  fyBoundaryQ4: string;
  fyBoundaryQ1: string;
}

export function buildExpected(lines: EnrichedLine[]): ExpectedFile {
  const latest = lines.at(-1)?.txnDate ?? "";
  const fiscal = fiscalContext(latest);
  const byMerchant = new Map<string, number>();
  const byMonth = new Map<string, number>();
  for (const line of lines) {
    const spent = expenseAmount(line);
    if (spent === 0) continue;
    byMerchant.set(line.merchant, round2((byMerchant.get(line.merchant) ?? 0) + spent));
    const month = line.txnDate.slice(0, 7);
    byMonth.set(month, round2((byMonth.get(month) ?? 0) + spent));
  }
  const topMerchants = [...byMerchant.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).slice(0, 5);
  const topMonth = [...byMonth.entries()].sort((a, b) => b[1] - a[1])[0];
  const topMonthMerchants = lines
    .filter((line) => line.txnDate.startsWith(topMonth?.[0] ?? "") && expenseAmount(line) > 0)
    .reduce((map, line) => {
      map.set(line.merchant, round2((map.get(line.merchant) ?? 0) + expenseAmount(line)));
      return map;
    }, new Map<string, number>());
  const why = [...topMonthMerchants.entries()].sort((a, b) => b[1] - a[1])[0];
  const groww = lines.filter((line) => line.merchant === "Groww");

  return {
    rowCount: lines.length,
    latestDate: latest,
    eatingOutLastMonth: sumWhere(lines, (line) => line.category === "food" && line.txnDate.startsWith("2025-08")),
    groceryThisQuarter: sumWhere(lines, (line) => line.category === "groceries" && line.txnDate >= fiscal.thisQuarter.start && line.txnDate <= fiscal.thisQuarter.end),
    groceryLastQuarter: sumWhere(lines, (line) => line.category === "groceries" && line.txnDate >= fiscal.lastQuarter.start && line.txnDate <= fiscal.lastQuarter.end),
    topMerchants,
    topMonth: topMonth?.[0] ?? "",
    topMonthTotal: topMonth?.[1] ?? 0,
    topMonthMerchant: why?.[0] ?? "",
    above5000Last30: lines.filter((line) => {
      const amount = Number(line.debit ?? line.credit ?? 0);
      return amount > 5000 && line.txnDate > shiftDays(latest, -30) && line.txnDate <= latest;
    }).length,
    julyFood: sumWhere(lines, (line) => line.category === "food" && line.txnDate.startsWith("2025-07")),
    earned: round2(
      lines.reduce((total, line) => {
        if (!isReceipt(line) || (line.category !== "interest" && line.category !== "tax_refund") || line.credit === null) return total;
        return total + Number(line.credit);
      }, 0),
    ),
    growwCount: groww.length,
    growwExpense: round2(groww.reduce((total, line) => total + expenseAmount(line), 0)),
    refundInExpenses: sumWhere(lines, (line) => line.isRefund),
    lastQuarterStart: fiscal.lastQuarter.start,
    lastQuarterEnd: fiscal.lastQuarter.end,
    thisQuarterStart: fiscal.thisQuarter.start,
    thisQuarterEnd: fiscal.thisQuarter.end,
    fyBoundaryQ4: fiscalQuarter("2025-03-31").label,
    fyBoundaryQ1: fiscalQuarter("2025-04-01").label,
  };
}

export function writeExpected(lines: EnrichedLine[]): ExpectedFile {
  const expected = buildExpected(lines);
  const root = path.resolve(__dirname, "../../..");
  mkdirSync(path.join(root, "eval"), { recursive: true });
  writeFileSync(path.join(root, "eval", "expected.json"), `${JSON.stringify(expected, null, 2)}\n`, "utf8");
  return expected;
}

function expenseAmount(line: EnrichedLine): number {
  if (!isExpense(line) || line.debit === null) return 0;
  return Number(line.debit);
}

function sumWhere(lines: EnrichedLine[], predicate: (line: EnrichedLine) => boolean): number {
  return round2(lines.reduce((total, line) => total + (predicate(line) ? expenseAmount(line) : 0), 0));
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function shiftDays(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 2025, (month ?? 1) - 1, day ?? 1));
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}
