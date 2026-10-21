import { fiscalContext } from "./fiscal.js";

export interface CoverageProfile {
  firstDate: string | null;
  latestDate: string | null;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function asksInterestFy(message: string): boolean {
  return /interest/i.test(message) && (/\bfy\b/i.test(message) || /financial year/i.test(message));
}

export function interestFySql(fyStart: string, fyEnd: string): string {
  return `SELECT COALESCE(SUM(amount), 0) AS total FROM v_transactions WHERE category = 'interest' AND txn_date >= DATE '${fyStart}' AND txn_date <= DATE '${fyEnd}'`;
}

export function formatInterestAnswer(
  profile: CoverageProfile,
  total: string,
  fy?: { label: string; start: string; end: string },
): string {
  const coverage = `The statement covers ${dmy(profile.firstDate)} to ${dmy(profile.latestDate)}.`;
  const period = fy ? `${fy.label} (${dmy(fy.start)} to ${dmy(fy.end)})` : "this financial year";
  const partial =
    fy && profile.latestDate && profile.latestDate < fy.end
      ? ` The loaded statement only covers this FY through ${dmy(profile.latestDate)}.`
      : "";
  return `${coverage} Interest credited in ${period} is Rs. ${rupees(total)}.${partial} This is bank interest shown on the statement. The statement does not split EMI interest.`;
}

export function formatInterestFromRows(message: string, rows: Array<Record<string, unknown>>, profile: CoverageProfile): string | null {
  if (!/interest/i.test(message) || rows.length !== 1 || !rows[0]) return null;
  const total = singleAmount(rows[0]);
  if (total === null) return null;
  const fy = profile.latestDate ? fiscalContext(profile.latestDate).fy : undefined;
  return formatInterestAnswer(profile, total, fy);
}

export type StatementSide = "credit" | "debit";

export interface MonthWindow {
  start: string;
  end: string;
  label: string;
}

export function sideStatement(message: string): StatementSide | null {
  if (/credit\s*-?\s*card/i.test(message)) return null;
  const wantsList = /\b(statement|list|show|give|all)\b/i.test(message);
  if (/\bcredits?\b/i.test(message) && !/\bdebits?\b/i.test(message) && (wantsList || /\bcredits?\s+(for|in|of)\b/i.test(message))) {
    return "credit";
  }
  if (/\bdebits?\b/i.test(message) && !/\bcredits?\b/i.test(message) && (wantsList || /\bdebits?\s+(for|in|of)\b/i.test(message))) {
    return "debit";
  }
  return null;
}

export function monthWindow(message: string): MonthWindow | null {
  const named = /\b(january|february|march|april|may|june|july|august|september|october|november|december|jan|feb|mar|apr|jun|jul|aug|sep|sept|oct|nov|dec)\.?\s*,?\s*(\d{4})\b/i.exec(
    message,
  );
  if (named?.[1] && named[2]) return windowFor(Number(named[2]), monthNumber(named[1]));
  const iso = /\b(\d{4})[-/](0?[1-9]|1[0-2])\b/.exec(message);
  if (iso?.[1] && iso[2]) return windowFor(Number(iso[1]), Number(iso[2]));
  const numbered = /\b(0?[1-9]|1[0-2])[-/](\d{4})\b/.exec(message);
  if (numbered?.[1] && numbered[2]) return windowFor(Number(numbered[2]), Number(numbered[1]));
  return null;
}

export function sideStatementSql(side: StatementSide, start: string, end: string): string {
  return `SELECT to_char(txn_date, 'YYYY-MM-DD') AS txn_date, channel, merchant, category, direction, amount FROM v_transactions WHERE direction = '${side}' AND txn_date >= DATE '${start}' AND txn_date <= DATE '${end}' ORDER BY txn_date, id`;
}

export function filterSideRows<T extends Record<string, unknown>>(message: string, rows: T[]): T[] {
  const side = sideStatement(message);
  if (!side) return rows;
  const hasDirection = rows.some((row) => typeof row.direction === "string" && String(row.direction).length > 0);
  if (!hasDirection) return rows;
  return rows.filter((row) => String(row.direction).toLowerCase() === side);
}

export function formatSideFromRows(message: string, rows: Array<Record<string, unknown>>, profile: CoverageProfile): string | null {
  const side = sideStatement(message);
  if (!side) return null;
  const window = monthWindow(message) ?? coverageWindow(profile);
  if (!window) return null;
  return formatSideStatement(profile, side, window, filterSideRows(message, rows));
}

export function formatSideStatement(
  profile: CoverageProfile,
  side: StatementSide,
  window: MonthWindow,
  rows: Array<Record<string, unknown>>,
): string {
  const coverage = `The statement covers ${dmy(profile.firstDate)} to ${dmy(profile.latestDate)}.`;
  if (outsideCoverage(profile, window)) {
    return `${coverage} ${window.label} is outside the loaded statement.`;
  }
  const total = rows.reduce((sum, row) => sum + Number(row.amount ?? 0), 0);
  const count = rows.length;
  const word = count === 1 ? side : `${side}s`;
  const other = side === "credit" ? "Debits are not included" : "Credits are not included";
  const truncated = count >= 200 ? " Showing the first 200." : "";
  return `${coverage} ${window.label} has ${count} ${word} totalling Rs. ${rupees(String(total))}. ${other}.${truncated}`;
}

export function isLlmTimeout(error: unknown): boolean {
  return isLlmUnavailable(error);
}

export function isLlmUnavailable(error: unknown): boolean {
  return (
    error instanceof Error &&
    /aborted due to timeout|the operation was aborted|503|429|high demand|RESOURCE_EXHAUSTED|unavailable/i.test(error.message)
  );
}

function singleAmount(row: Record<string, unknown>): string | null {
  const values = Object.entries(row)
    .filter(([key]) => /total|amount|sum|interest/i.test(key))
    .map(([, value]) => value);
  const picked = values[0] ?? Object.values(row)[0];
  if (picked === null || picked === undefined) return null;
  const text = String(picked);
  return /^-?\d+(\.\d+)?$/.test(text) ? text : null;
}

function rupees(value: string): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value));
}

function dmy(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "unknown";
  const [year, month, day] = iso.split("-");
  return `${Number(day)} ${MONTHS[Number(month) - 1]} ${year}`;
}

function monthNumber(name: string): number {
  const key = name.slice(0, 3).toLowerCase();
  const index = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"].indexOf(key);
  return index + 1;
}

export function monthBounds(year: number, month: number): MonthWindow {
  return windowFor(year, month);
}

function windowFor(year: number, month: number): MonthWindow {
  const start = `${year}-${String(month).padStart(2, "0")}-01`;
  const last = new Date(Date.UTC(year, month, 0)).getUTCDate();
  const end = `${year}-${String(month).padStart(2, "0")}-${String(last).padStart(2, "0")}`;
  const label = `${["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"][month - 1]} ${year}`;
  return { start, end, label };
}

function coverageWindow(profile: CoverageProfile): MonthWindow | null {
  if (!profile.firstDate || !profile.latestDate) return null;
  return { start: profile.firstDate, end: profile.latestDate, label: "The loaded statement" };
}

function outsideCoverage(profile: CoverageProfile, window: MonthWindow): boolean {
  if (profile.latestDate && profile.latestDate < window.start) return true;
  if (profile.firstDate && profile.firstDate > window.end) return true;
  return false;
}
