import { statementFinancialYear } from "./fiscal.js";
import { matchSpendTarget } from "./intent.js";
import type { CoverageProfile } from "./known-answer.js";

export interface DirectReply {
  sql: string;
  answer(rows: Array<Record<string, unknown>>): string;
}

const MONTHS = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function planDirectReply(message: string, profile: CoverageProfile): DirectReply | null {
  return (
    planNarration(message, profile) ??
    planEmiInterest(message, profile) ??
    planAfford(message, profile) ??
    planCash(message, profile) ??
    planSaving(message, profile) ??
    planInvested(message, profile) ??
    planEarnings(message, profile) ??
    planMonthly(message, profile) ??
    planParts(message, profile)
  );
}

export function asksMerchantBreakdown(message: string): boolean {
  return /\b(break (?:that|it|this) down|by merchant)\b/i.test(message);
}

export function formatMerchantBreakdown(rows: Array<Record<string, unknown>>, profile: CoverageProfile): string | null {
  const lines = rows.filter((row) => typeof row.merchant === "string" && row.merchant && amountOf(row) !== null);
  if (lines.length === 0) return null;
  const body = lines.map((row) => `${row.merchant}: Rs. ${rupees(amountOf(row) as string | number)}`).join("\n");
  return `${coverage(profile)}\n\nBy merchant:\n${body}`;
}

function planNarration(message: string, profile: CoverageProfile): DirectReply | null {
  if (!asksNarration(message)) return null;
  const runs = digitRuns(message);
  if (runs.length === 0) return null;
  const match = runs.map((run) => `description LIKE '%${run}%'`).join(" AND ");
  return {
    sql: `SELECT to_char(txn_date, 'YYYY-MM-DD') AS txn_date, merchant, category, direction, amount, user_label FROM v_transactions WHERE ${match} ORDER BY txn_date, id`,
    answer(rows) {
      const lead = coverage(profile);
      if (rows.length === 0) {
        return `${lead} That narration is not on the loaded statement. A narration names the other party. It does not store a purpose unless you have labelled the payee.`;
      }
      const shown = rows.slice(0, 8).map((row) => narrationLine(row));
      const extra = rows.length > shown.length ? ` ${rows.length - shown.length} more matching rows are in the table.` : "";
      return `${lead} ${rows.length} matching ${rows.length === 1 ? "line" : "lines"}.${extra}\n${shown.join("\n")}\nThe narration does not say the purpose. It is not rent, salary, or a refund unless a payee label says so.`;
    },
  };
}

function planEmiInterest(message: string, profile: CoverageProfile): DirectReply | null {
  if (!/\bemi\b/i.test(message) || !/\binterest\b/i.test(message)) return null;
  return {
    sql: "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS row_count FROM v_transactions WHERE category = 'loan_emi' OR is_emi",
    answer(rows) {
      const total = rows[0]?.total ?? "0";
      const count = Number(rows[0]?.row_count ?? 0);
      return `${coverage(profile)} Loan/EMI repayments total Rs. ${rupees(total as string | number)} over ${count} ${count === 1 ? "row" : "rows"}. The statement does not split that into principal and interest, so no interest portion is available.`;
    },
  };
}

function planAfford(message: string, profile: CoverageProfile): DirectReply | null {
  if (!/\bafford\b/i.test(message) || !/\b(emi|loan)\b/i.test(message)) return null;
  if (!profile.firstDate || !profile.latestDate) return null;
  return {
    sql: monthlySql(profile.firstDate, profile.latestDate, true),
    answer(rows) {
      return `${coverage(profile)}\n${monthLines(rows, true)}\nThis is cash movement only. It is not a loan approval.`;
    },
  };
}

function planCash(message: string, profile: CoverageProfile): DirectReply | null {
  if (!/\b(atm|cash)\b/i.test(message) || !/\bwithdraw/i.test(message)) return null;
  return {
    sql: "SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS row_count FROM v_transactions WHERE category = 'cash' AND direction = 'debit'",
    answer(rows) {
      const total = rows[0]?.total ?? "0";
      const count = Number(rows[0]?.row_count ?? 0);
      return `${coverage(profile)} Cash withdrawals are Rs. ${rupees(total as string | number)} over ${count} ${count === 1 ? "row" : "rows"}. They are not included in spending. Spending leaves out ATM cash.`;
    },
  };
}

function planSaving(message: string, profile: CoverageProfile): DirectReply | null {
  const saving = /\bsav(?:e|ed|ing|ings)\b/i.test(message);
  const movement =
    /\b(came\s+in|money\s+in)\b/i.test(message) && /\b(went\s+out|money\s+out|versus|vs\.?)\b/i.test(message);
  const received = /\bspend more than\b/i.test(message) && /\breceived\b/i.test(message);
  if (!saving && !movement && !received) return null;
  if (!profile.firstDate || !profile.latestDate) return null;
  const year = statementFinancialYear(profile.firstDate, profile.latestDate);
  return {
    sql: `WITH totals AS (
      SELECT
        ROUND(COALESCE(SUM(amount) FILTER (WHERE is_receipt), 0), 2) AS receipts,
        ROUND(COALESCE(SUM(amount) FILTER (WHERE is_expense), 0), 2) AS expenses,
        ROUND(COALESCE(SUM(amount) FILTER (WHERE is_outflow), 0), 2) AS outflow
      FROM v_transactions
      WHERE txn_date >= DATE '${profile.firstDate}' AND txn_date <= DATE '${profile.latestDate}'
    )
    SELECT receipts::text AS receipts, expenses::text AS expenses, outflow::text AS outflow,
      ROUND(receipts - outflow, 2)::text AS net,
      CASE WHEN receipts = 0 THEN '0' ELSE ROUND(100.0 * (receipts - outflow) / receipts, 2)::text END AS savings_rate_pct
    FROM totals`,
    answer(rows) {
      const receipts = rows[0]?.receipts ?? "0";
      const expenses = rows[0]?.expenses ?? "0";
      const outflow = rows[0]?.outflow ?? "0";
      const net = rows[0]?.net ?? "0";
      const rate = rows[0]?.savings_rate_pct ?? "0";
      const invested = Number(outflow) - Number(expenses);
      const decision = Number(net) > 0 ? "Yes." : "No.";
      const stub = year.opened
        ? ` ${dmy(year.opened.start)} is only the opening of ${year.opened.label} and is inside this total.`
        : "";
      return `${decision} ${coverage(profile)} Money in was Rs. ${paise(receipts as string | number)}. Money out, including investments, was Rs. ${paise(outflow as string | number)}. That leaves Rs. ${paise(net as string | number)}, a savings rate of ${rate}%. Spending was Rs. ${paise(expenses as string | number)}. Rs. ${paise(invested)} of money out is investment and is not spending.${stub}`;
    },
  };
}

function planInvested(message: string, profile: CoverageProfile): DirectReply | null {
  if (!/\b(put|invested|investment|into)\b/i.test(message) || !/\b(expense|expenses|spending|spend)\b/i.test(message)) return null;
  const groww = /\bgroww\b/i.test(message);
  const investment = /\b(investment|mutual fund)\b/i.test(message);
  if (!groww && !investment) return null;
  const where = groww ? "merchant ILIKE '%groww%'" : "category = 'investment'";
  const name = groww ? "Groww" : "Investment";
  return {
    sql: `SELECT COALESCE(SUM(amount), 0) AS invested, COUNT(*) AS row_count, COALESCE(SUM(amount) FILTER (WHERE is_expense), 0) AS in_expenses FROM v_transactions WHERE ${where}`,
    answer(rows) {
      const invested = rows[0]?.invested ?? "0";
      const count = Number(rows[0]?.row_count ?? 0);
      const expenses = rows[0]?.in_expenses ?? "0";
      return `${coverage(profile)} ${name} transactions total Rs. ${rupees(invested as string | number)} over ${count} ${count === 1 ? "row" : "rows"}. Rs. ${rupees(expenses as string | number)} of that is included in expenses. Investment is not counted as spending.`;
    },
  };
}

function planEarnings(message: string, profile: CoverageProfile): DirectReply | null {
  const earned = /\b(earn|earning|earnings|earned)\b/i.test(message);
  const inflow = /\b(came in|money in|receipts?)\b/i.test(message);
  if (!earned || !inflow) return null;
  return {
    sql: "SELECT COALESCE(SUM(amount) FILTER (WHERE category IN ('interest', 'tax_refund') AND is_receipt), 0) AS earnings, COALESCE(SUM(amount) FILTER (WHERE is_receipt), 0) AS receipts FROM v_transactions",
    answer(rows) {
      const earnings = rows[0]?.earnings ?? "0";
      const receipts = rows[0]?.receipts ?? "0";
      return `${coverage(profile)} Earnings, which are only interest and tax refund, are Rs. ${rupees(earnings as string | number)} on the loaded statement. Money that came in, excluding loan credits, is Rs. ${rupees(receipts as string | number)}.`;
    },
  };
}

function planMonthly(message: string, profile: CoverageProfile): DirectReply | null {
  if (!/\b(per month|each month|every month|month by month|by month)\b/i.test(message)) return null;
  if (!/\b(spend|spent|spending|pay|paid)\b/i.test(message)) return null;
  if (!profile.latestDate) return null;
  const year = statementFinancialYear(profile.firstDate, profile.latestDate);
  const note = year.opened
    ? `${year.opened.label} starts on ${dmy(year.opened.start)} and has no full month on this statement. These months are ${year.year.label}, ${dmy(year.year.start)} to ${dmy(year.year.end)}.`
    : `${year.year.label} is ${dmy(year.year.start)} to ${dmy(year.year.end)}.`;
  return {
    sql: monthlySql(year.year.start, year.year.end, false),
    answer(rows) {
      return `${coverage(profile)} ${note} Loan/EMI sits inside the expense total.\n${monthLines(rows, false)}`;
    },
  };
}

function planParts(message: string, profile: CoverageProfile): DirectReply | null {
  if (!/\b(spend|spent|spending|pay|paid)\b/i.test(message) || !/\band\b/i.test(message)) return null;
  const focus = message.replace(/^.*?\b(?:on|at)\b/i, "");
  if (focus === message) return null;
  const chunks = focus
    .split(/\band\b/i)
    .map((chunk) => chunk.replace(/[?.,]/g, "").trim())
    .filter((chunk) => chunk.length > 0);
  if (chunks.length < 2) return null;
  const targets = chunks.map((chunk) => matchSpendTarget(chunk));
  if (targets.some((target) => target === null)) return null;
  const picked = targets.filter((target) => target !== null);
  const columns = picked.map((target, index) => `COALESCE(SUM(amount) FILTER (WHERE ${target.predicate} AND is_expense), 0) AS part_${index}`);
  return {
    sql: `SELECT ${columns.join(", ")} FROM v_transactions`,
    answer(rows) {
      const row = rows[0] ?? {};
      const lines = picked.map((target, index) => `${target.label} spending is Rs. ${rupees((row[`part_${index}`] as string | number | null) ?? 0)}.`);
      return `${coverage(profile)} ${lines.join(" ")}`;
    },
  };
}

function asksNarration(message: string): boolean {
  if (/\b(account\s*numbers?|ifsc|aadhaar|\bpan\b)\b/i.test(message)) return false;
  const compact = message.replace(/\s/g, "");
  if (/\d{8,}[A-Za-z]|[A-Za-z]\d{8,}/.test(compact)) return true;
  return /\d{10,}/.test(message) && /\b(for|purpose|narration|mean|means)\b/i.test(message);
}

function digitRuns(message: string): string[] {
  return [...new Set(message.match(/\d{8,}/g) ?? [])];
}

function monthlySql(start: string, end: string, withReceipts: boolean): string {
  const receipts = withReceipts ? ", COALESCE(SUM(amount) FILTER (WHERE is_receipt), 0) AS receipts" : "";
  return `SELECT to_char(date_trunc('month', txn_date), 'YYYY-MM') AS month, COALESCE(SUM(amount) FILTER (WHERE is_expense), 0) AS expenses, COALESCE(SUM(amount) FILTER (WHERE category = 'loan_emi' OR is_emi), 0) AS loan_emi${receipts} FROM v_transactions WHERE txn_date >= DATE '${start}' AND txn_date <= DATE '${end}' GROUP BY 1 ORDER BY 1`;
}

function monthLines(rows: Array<Record<string, unknown>>, withReceipts: boolean): string {
  if (rows.length === 0) return "No months are in that period.";
  return rows
    .map((row) => {
      const emi = ` Loan/EMI Rs. ${rupees((row.loan_emi as string | number | null) ?? 0)}.`;
      const receipts = withReceipts ? ` Money in Rs. ${rupees((row.receipts as string | number | null) ?? 0)}.` : "";
      return `${monthLabel(row.month)}: expenses Rs. ${rupees((row.expenses as string | number | null) ?? 0)}.${emi}${receipts}`;
    })
    .join("\n");
}

function narrationLine(row: Record<string, unknown>): string {
  const label = row.user_label ? ` Label: ${row.user_label}.` : " No payee label.";
  return `${dmy(String(row.txn_date ?? ""))} ${row.direction} Rs. ${rupees((row.amount as string | number | null) ?? 0)}, ${row.merchant}, ${row.category}.${label}`;
}

function amountOf(row: Record<string, unknown>): string | number | null {
  for (const key of ["total", "amount", "expenses"]) {
    const value = row[key];
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return null;
}

function monthLabel(value: unknown): string {
  const text = String(value ?? "").slice(0, 7);
  const [year, month] = text.split("-");
  const name = MONTHS[Number(month) - 1];
  return name && year ? `${name} ${year}` : text;
}

function coverage(profile: CoverageProfile): string {
  return `The statement covers ${dmy(profile.firstDate)} to ${dmy(profile.latestDate)}.`;
}

function dmy(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}/.test(iso)) return "unknown";
  const [year, month, day] = iso.slice(0, 10).split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]?.slice(0, 3) ?? ""} ${year}`;
}

function rupees(value: string | number): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value));
}

function paise(value: string | number): string {
  return new Intl.NumberFormat("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 }).format(Number(value));
}
