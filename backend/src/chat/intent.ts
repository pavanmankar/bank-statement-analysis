import { CATEGORIES } from "../types.js";
import { fiscalContext } from "./fiscal.js";
import {
  formatInterestAnswer,
  formatSideStatement,
  monthBounds,
  monthWindow,
  type CoverageProfile,
  type MonthWindow,
  type StatementSide,
} from "./known-answer.js";
export type Measure = "expense" | "outflow" | "receipt" | "earnings" | "interest";

export interface QueryIntent {
  listing: boolean;
  needsModel: boolean;
  side: StatementSide | null;
  category: string | null;
  merchant: string | null;
  source: string | null;
  measure: Measure | null;
  window: MonthWindow | null;
  minAmount: number | null;
}

const CATEGORY_HINTS: Array<[RegExp, string]> = [
  [/\b(eating out|eat out|restaurants?|dining out|\bfood\b)\b/i, "food"],
  [/\b(grocer(?:y|ies)|supermarket)\b/i, "groceries"],
  [/\bshopping\b/i, "shopping"],
  [/\b(flight|travel)\b/i, "travel"],
  [/\b(movie|entertainment)\b/i, "entertainment"],
  [/\b(electricity|recharge|bills?)\b/i, "bills"],
  [/\b(atm|cash withdraw)\b/i, "cash"],
  [/\bemi\b/i, "loan_emi"],
  [/\b(mutual fund|investment)\b/i, "investment"],
  [/\binterest\b/i, "interest"],
  [/\btax refund\b/i, "tax_refund"],
  [/\b(fees?|charges?|penalt(?:y|ies))\b/i, "fees"],
];

const PAYEE_HINTS: Array<{ pattern: RegExp; merchant: string; source?: string }> = [
  { pattern: /\bamazon\b/i, merchant: "amazon", source: "grocery:amazon" },
  { pattern: /\bflipkart\b/i, merchant: "flipkart", source: "grocery:flipkart" },
  { pattern: /\bmyntra\b/i, merchant: "myntra" },
  { pattern: /\bmeesho\b/i, merchant: "meesho" },
  { pattern: /\bswiggy\b/i, merchant: "swiggy", source: "food:swiggy" },
  { pattern: /\bzomato\b/i, merchant: "zomato", source: "food:zomato" },
  { pattern: /\bdomino'?s?\b/i, merchant: "dominos", source: "food:dominos" },
  { pattern: /\bpizza\s*hut\b/i, merchant: "pizza hut", source: "food:pizzahut" },
  { pattern: /\bkfc\b/i, merchant: "kfc", source: "food:kfc" },
  { pattern: /\bmcdonald/i, merchant: "mcdonald", source: "food:mcdonalds" },
  { pattern: /\bburger\s*king\b/i, merchant: "burger king", source: "food:burgerking" },
  { pattern: /\bsubway\b/i, merchant: "subway", source: "food:subway" },
  { pattern: /\bdmart\b|\bavenue supermarts\b/i, merchant: "dmart", source: "grocery:dmart" },
  { pattern: /\bblinkit\b/i, merchant: "blinkit", source: "grocery:blinkit" },
  { pattern: /\bredbus\b/i, merchant: "redbus" },
  { pattern: /\buber\b/i, merchant: "uber" },
  { pattern: /\bola\b/i, merchant: "ola" },
  { pattern: /\bnetflix\b/i, merchant: "netflix" },
  { pattern: /\bhotstar\b/i, merchant: "hotstar" },
  { pattern: /\bairtel\b/i, merchant: "airtel" },
  { pattern: /\bgroww\b/i, merchant: "groww" },
  { pattern: /\bfibe\b/i, merchant: "fibe", source: "transfer:fibe" },
];

const RESERVED_PAYEE =
  /^(the|a|an|my|our|we|i|you|this|that|last|food|groceries|grocery|shopping|travel|entertainment|bills|cash|interest|refund|statement|credit|debit|expense|expenses|spending|month|year|quarter|eating|dining|restaurant|restaurants)$/i;

const CATEGORY_LEAD =
  /\b(?:on|at)\s+(?:eating out|eat out|dining out|restaurants?|grocer(?:y|ies)|supermarket)\b/i;

const NEEDS_MODEL =
  /\b(why|compar(?:e|ison)|vs\.?|versus|breakdown|top\s+\d|highest|lowest|month on month|difference|previous|prior|before)\b/i;

export function parseIntent(message: string, profile: CoverageProfile): QueryIntent {
  const needsModel = NEEDS_MODEL.test(message);
  const side = parseSide(message);
  const payee = parsePayee(message);
  const category = payee ? null : parseCategory(message);
  const measure = parseMeasure(message, side);
  const listing = parseListing(message, side);
  const window = parseWindow(message, profile);
  const minAmount = parseMinAmount(message);
  return {
    listing,
    needsModel,
    side,
    category,
    merchant: payee?.merchant ?? null,
    source: payee?.source ?? null,
    measure,
    window,
    minAmount,
  };
}

export function canAnswerLocally(intent: QueryIntent): boolean {
  if (intent.needsModel) return false;
  if (intent.listing && (intent.side || intent.category || intent.merchant || intent.window || intent.minAmount !== null)) return true;
  if (!intent.listing && (intent.measure || intent.side) && (intent.window || intent.category || intent.merchant || intent.measure === "interest" || intent.measure === "earnings")) {
    return true;
  }
  return false;
}

export function sqlSatisfies(intent: QueryIntent, sql: string): boolean {
  const text = sql.toLowerCase().replace(/\s+/g, " ");
  if (intent.side && !text.includes(`direction = '${intent.side}'`) && !text.includes(`direction='${intent.side}'`)) return false;
  if (intent.category && !text.includes(`category = '${intent.category}'`) && !text.includes(`category='${intent.category}'`)) return false;
  if (intent.merchant && !text.includes(intent.merchant.toLowerCase())) return false;
  if (intent.window && !text.includes(intent.window.start) && !text.includes(intent.window.start.slice(0, 7))) return false;
  if (intent.measure === "expense" && !text.includes("is_expense")) return false;
  if (intent.measure === "outflow" && !text.includes("is_outflow")) return false;
  if (intent.measure === "receipt" && !text.includes("is_receipt")) return false;
  if (intent.measure === "interest" && !text.includes("interest")) return false;
  if (intent.measure === "earnings" && !text.includes("interest") && !text.includes("tax_refund")) return false;
  if (intent.minAmount !== null && !text.includes(String(intent.minAmount))) return false;
  return true;
}

export function rowsViolate(intent: QueryIntent, rows: Array<Record<string, unknown>>): boolean {
  if (intent.side && hasColumn(rows, "direction") && rows.some((row) => String(row.direction).toLowerCase() !== intent.side)) return true;
  if (intent.category && hasColumn(rows, "category") && rows.some((row) => String(row.category) !== intent.category)) return true;
  if (intent.merchant && hasColumn(rows, "merchant") && rows.some((row) => !payeeMatches(row, intent))) return true;
  if (intent.window && hasColumn(rows, "txn_date")) {
    const { start, end } = intent.window;
    if (rows.some((row) => {
      const day = String(row.txn_date).slice(0, 10);
      return day < start || day > end;
    })) {
      return true;
    }
  }
  return false;
}

export function applyIntentToRows<T extends Record<string, unknown>>(intent: QueryIntent, rows: T[]): T[] {
  let next = rows;
  if (intent.side && hasColumn(rows, "direction")) {
    next = next.filter((row) => String(row.direction).toLowerCase() === intent.side);
  }
  if (intent.category && hasColumn(next, "category")) {
    next = next.filter((row) => String(row.category) === intent.category);
  }
  if (intent.merchant && hasColumn(next, "merchant")) {
    next = next.filter((row) => payeeMatches(row, intent));
  }
  if (intent.window && hasColumn(next, "txn_date")) {
    const { start, end } = intent.window;
    next = next.filter((row) => {
      const day = String(row.txn_date).slice(0, 10);
      return day >= start && day <= end;
    });
  }
  if (intent.minAmount !== null && hasColumn(next, "amount")) {
    next = next.filter((row) => Number(row.amount) > intent.minAmount!);
  }
  return next;
}

export function canonicalSql(intent: QueryIntent): string {
  const where = whereClauses(intent);
  const filter = where.length > 0 ? where.join(" AND ") : "TRUE";
  if (intent.listing) {
    return `SELECT to_char(txn_date, 'YYYY-MM-DD') AS txn_date, channel, merchant, category, direction, amount FROM v_transactions WHERE ${filter} ORDER BY txn_date, id`;
  }
  return `SELECT COALESCE(SUM(amount), 0) AS total, COUNT(*) AS row_count FROM v_transactions WHERE ${filter}`;
}

export function summarizeRows(rows: Array<Record<string, unknown>>, profile: CoverageProfile): string | null {
  if (rows.length === 0) return null;
  const total = totalOf(rows);
  if (total === null) return null;
  const coverage = `The statement covers ${dmy(profile.firstDate)} to ${dmy(profile.latestDate)}.`;
  if (hasColumn(rows, "txn_date")) {
    return `${coverage} ${rows.length} matching ${rows.length === 1 ? "row" : "rows"} totalling Rs. ${rupees(total)}. Only rows matching the question are included.`;
  }
  return `${coverage} The query total is Rs. ${rupees(total)}.`;
}

export function formatFromIntent(
  intent: QueryIntent,
  rows: Array<Record<string, unknown>>,
  profile: CoverageProfile,
): string | null {
  if (intent.needsModel) return null;
  const filtered = applyIntentToRows(intent, rows);
  if (intent.measure === "interest" || intent.measure === "earnings") {
    const total = totalOf(filtered);
    if (total === null) return null;
    const fy = profile.latestDate ? fiscalContext(profile.latestDate).fy : undefined;
    return formatInterestAnswer(profile, total, fy);
  }
  const window = intent.window ?? coverageWindow(profile);
  if (!window) return null;
  if (intent.side && intent.listing) {
    return formatSideStatement(profile, intent.side, window, filtered);
  }
  const total = totalOf(filtered);
  if (total === null) return null;
  const coverage = `The statement covers ${dmy(profile.firstDate)} to ${dmy(profile.latestDate)}.`;
  const counted = countedLabel(intent);
  const count = listingCount(filtered);
  const countBit = intent.listing ? ` over ${count} ${count === 1 ? "row" : "rows"}` : count ? ` over ${count} ${count === 1 ? "row" : "rows"}` : "";
  const extra = hasNamedFilter(intent) ? " Only rows matching the question are included." : "";
  return `${coverage} ${window.label} ${counted} is Rs. ${rupees(total)}.${countBit}.${extra}`.replace(/\.\./g, ".");
}

function hasNamedFilter(intent: QueryIntent): boolean {
  return Boolean(intent.side || intent.category || intent.merchant || intent.window || intent.measure || intent.minAmount !== null);
}

function parseSide(message: string): StatementSide | null {
  if (/credit\s*-?\s*card/i.test(message)) return null;
  if (/\bcredits?\b/i.test(message) && !/\bdebits?\b/i.test(message)) return "credit";
  if (/\bdebits?\b/i.test(message) && !/\bcredits?\b/i.test(message)) return "debit";
  return null;
}

function parseListing(message: string, side: StatementSide | null): boolean {
  if (/\bhow much\b/i.test(message) || /\btotal\b/i.test(message)) return false;
  if (/\b(statement|list|show|give|all|transactions?)\b/i.test(message)) return true;
  return Boolean(side && /\b(only|just)\b/i.test(message));
}

function parsePayee(message: string): { merchant: string; source?: string } | null {
  const known = PAYEE_HINTS.find((hint) => hint.pattern.test(message));
  if (!known && CATEGORY_LEAD.test(message)) return null;
  if (known) return { merchant: known.merchant, source: known.source };
  const named = /\b(?:on|at)\s+([A-Za-z][A-Za-z0-9&.']{1,40})\b/i.exec(message);
  if (!named?.[1] || RESERVED_PAYEE.test(named[1]) || parseCategory(named[1])) return null;
  const rest = message.slice(named.index);
  if (/^(?:on|at)\s+(?:eating|eat|dining|restaurant)/i.test(rest)) return null;
  return { merchant: named[1].toLowerCase() };
}

export interface SpendTarget {
  label: string;
  predicate: string;
}

export function matchSpendTarget(text: string): SpendTarget | null {
  const payee = PAYEE_HINTS.find((hint) => hint.pattern.test(text));
  if (payee) return { label: titlePayee(payee.merchant), predicate: payeeSql(payee.merchant, payee.source ?? null) };
  const category = parseCategory(text);
  if (!category) return null;
  const label = /\beating out|eat out|dining out\b/i.test(text) ? "eating out" : category;
  return { label, predicate: `category = '${category}'` };
}

function parseCategory(message: string): string | null {
  for (const [pattern, category] of CATEGORY_HINTS) {
    if (pattern.test(message) && (CATEGORIES as readonly string[]).includes(category)) return category;
  }
  return null;
}

function parseMeasure(message: string, side: StatementSide | null): Measure | null {
  if (side) return null;
  if (/\binterest\b/i.test(message)) return "interest";
  if (/\b(earn|earning|earnings)\b/i.test(message)) return "earnings";
  if (/\b(money out|where did money go|outflow)\b/i.test(message)) return "outflow";
  if (/\b(came in|money in|receipts?)\b/i.test(message)) return "receipt";
  if (/\b(spend|spent|spending|expense|expenses)\b/i.test(message)) return "expense";
  return null;
}

function parseWindow(message: string, profile: CoverageProfile): MonthWindow | null {
  const named = monthWindow(message);
  if (named) return named;
  if (!profile.latestDate) return null;
  const latest = profile.latestDate;
  const fiscal = fiscalContext(latest);
  if (/\b(this\s+fy|financial year|\bfy\b)\b/i.test(message) && !/\blast\s+fy\b/i.test(message)) {
    const end = latest < fiscal.fy.end ? latest : fiscal.fy.end;
    return { start: fiscal.fy.start, end, label: fiscal.fy.label };
  }
  if (/\bthis\s+quarter\b/i.test(message)) return { ...fiscal.thisQuarter };
  if (/\blast\s+quarter\b/i.test(message)) return { ...fiscal.lastQuarter };
  if (/\blast\s+30\s+days\b/i.test(message)) {
    return { start: shiftDays(latest, -29), end: latest, label: "the last 30 days" };
  }
  if (/\blast\s+3\s+months\b|\blast three months\b/i.test(message)) {
    const start = calendarMonth(latest, -2).start;
    return { start, end: latest, label: "the last 3 months" };
  }
  if (/\blast\s+month\b/i.test(message)) return calendarMonth(latest, -1);
  if (/\bthis\s+month\b/i.test(message)) return calendarMonth(latest, 0);
  return null;
}

function parseMinAmount(message: string): number | null {
  const matched = /\b(?:above|over|greater than|>)\s*(?:rs\.?\s*)?(\d[\d,]*)\b/i.exec(message);
  if (!matched?.[1]) return null;
  return Number(matched[1].replace(/,/g, ""));
}

function whereClauses(intent: QueryIntent): string[] {
  const where: string[] = [];
  if (intent.side) where.push(`direction = '${intent.side}'`);
  if (intent.category) where.push(`category = '${intent.category}'`);
  if (intent.merchant) where.push(payeeSql(intent.merchant, intent.source));
  if (intent.measure === "expense") where.push("is_expense");
  if (intent.measure === "outflow") where.push("is_outflow");
  if (intent.measure === "receipt") where.push("is_receipt");
  if (intent.measure === "interest") where.push("category = 'interest'");
  if (intent.measure === "earnings") where.push("category IN ('interest', 'tax_refund')");
  if (intent.window) {
    where.push(`txn_date >= DATE '${intent.window.start}'`);
    where.push(`txn_date <= DATE '${intent.window.end}'`);
  }
  if (intent.minAmount !== null) where.push(`amount > ${intent.minAmount}`);
  return where;
}

function payeeSql(merchant: string, source: string | null): string {
  const token = sqlToken(merchant);
  const like = `merchant ILIKE '%${token}%'`;
  return source ? `(${like} OR source = '${source}')` : like;
}

function payeeMatches(row: Record<string, unknown>, intent: QueryIntent): boolean {
  if (!intent.merchant) return true;
  const token = intent.merchant.toLowerCase();
  if (String(row.merchant ?? "").toLowerCase().includes(token)) return true;
  return Boolean(intent.source && String(row.source ?? "") === intent.source);
}

function sqlToken(value: string): string {
  return value.toLowerCase().replace(/[^a-z0-9 ]/g, "").trim();
}

function titlePayee(merchant: string): string {
  return merchant.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function countedLabel(intent: QueryIntent): string {
  if (intent.side === "credit") return "credits";
  if (intent.side === "debit") return "debits";
  if (intent.merchant && intent.measure === "expense") return `${titlePayee(intent.merchant)} spending`;
  if (intent.merchant) return titlePayee(intent.merchant);
  if (intent.measure === "expense") return intent.category ? `${intent.category} spending` : "spending";
  if (intent.measure === "outflow") return "money out";
  if (intent.measure === "receipt") return "money in";
  if (intent.category) return intent.category;
  return "the total";
}

function totalOf(rows: Array<Record<string, unknown>>): string | null {
  if (rows.length === 1 && rows[0]) {
    const direct = amountLike(rows[0]);
    if (direct !== null && !hasColumn(rows, "txn_date")) return direct;
  }
  if (!hasColumn(rows, "amount") && rows.length !== 1) return null;
  const sum = rows.reduce((total, row) => total + Number(row.amount ?? amountLike(row) ?? 0), 0);
  return String(sum);
}

function amountLike(row: Record<string, unknown>): string | null {
  const values = Object.entries(row)
    .filter(([key]) => /total|amount|sum/i.test(key))
    .map(([, value]) => value);
  const picked = values[0];
  if (picked === null || picked === undefined) return null;
  const text = String(picked);
  return /^-?\d+(\.\d+)?$/.test(text) ? text : null;
}

function listingCount(rows: Array<Record<string, unknown>>): number {
  if (rows.length === 1 && rows[0] && hasOwn(rows[0], "row_count")) return Number(rows[0].row_count);
  return rows.length;
}

function hasOwn(row: Record<string, unknown>, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(row, key);
}

function hasColumn(rows: Array<Record<string, unknown>>, key: string): boolean {
  return rows.some((row) => row[key] !== undefined && row[key] !== null);
}

function coverageWindow(profile: CoverageProfile): MonthWindow | null {
  if (!profile.firstDate || !profile.latestDate) return null;
  return { start: profile.firstDate, end: profile.latestDate, label: "The loaded statement" };
}

function calendarMonth(latest: string, offset: number): MonthWindow {
  const [year, month] = latest.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 2025, (month ?? 1) - 1 + offset, 1));
  return monthBounds(date.getUTCFullYear(), date.getUTCMonth() + 1);
}

function shiftDays(iso: string, days: number): string {
  const date = new Date(`${iso}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function rupees(value: string): string {
  return new Intl.NumberFormat("en-IN", { maximumFractionDigits: 2 }).format(Number(value));
}

function dmy(iso: string | null): string {
  if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) return "unknown";
  const months = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
  const [year, month, day] = iso.split("-");
  return `${Number(day)} ${months[Number(month) - 1]} ${year}`;
}
