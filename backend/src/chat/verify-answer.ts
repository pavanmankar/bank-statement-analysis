import type { MaskedRow } from "./mask.js";
import { summarizeToolRows } from "./tool-summary.js";

const MONTH = /jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?/i;
const FALLBACK = "I could not verify every figure in that reply. The table below is the query result.";

export interface VerifyResult {
  ok: boolean;
  unverified: string[];
}

export function verifyAnswer(answer: string, rows: MaskedRow[], extras: number[] = []): VerifyResult {
  const allowed = collectAllowed(rows);
  for (const extra of extras) {
    allowed.amounts.push(extra);
    allowed.percents.push(extra);
  }
  const claimed = extractNumbers(answer);
  const unverified = claimed.filter((item) => !matchesAllowed(item.value, item.kind, allowed)).map((item) => item.raw);
  return { ok: unverified.length === 0, unverified };
}

export function rewriteInstruction(unverified: string[]): string {
  return `These numbers are not in the results: ${unverified.join(", ")}. Rewrite using only values from the results.`;
}

export function unverifiedFallback(rows: MaskedRow[]): string {
  const summary = summarizeToolRows(rows);
  const table = summary.rows
    .map((row) =>
      Object.entries(row)
        .map(([key, value]) => `${key}=${value}`)
        .join(", "),
    )
    .join("; ");
  return table ? `${FALLBACK} ${table}` : FALLBACK;
}

interface Claimed {
  raw: string;
  value: number;
  kind: "amount" | "percent";
}

function extractNumbers(answer: string): Claimed[] {
  const claimed: Claimed[] = [];
  const used: Array<[number, number]> = [];

  const take = (raw: string, value: number, kind: Claimed["kind"], index: number): void => {
    const end = index + raw.length;
    if (used.some(([start, stop]) => index < stop && end > start)) return;
    used.push([index, end]);
    if (shouldIgnore(answer, raw, index, kind)) return;
    claimed.push({ raw, value, kind });
  };

  const percent = /(\d+(?:\.\d+)?)\s*%/g;
  for (const match of answer.matchAll(percent)) {
    take(match[0], Number(match[1]), "percent", match.index ?? 0);
  }

  const suffixed = /(\d+(?:\.\d+)?)\s*(lakh|lac|k|l)\b/gi;
  for (const match of answer.matchAll(suffixed)) {
    const unit = match[2].toLowerCase();
    const n = Number(match[1]);
    const value = unit === "k" ? n * 1000 : n * 100_000;
    take(match[0], value, "amount", match.index ?? 0);
  }

  const rupees = /\bRs\.?\s*([\d,]+(?:\.\d+)?)/gi;
  for (const match of answer.matchAll(rupees)) {
    take(match[0], Number(match[1].replace(/,/g, "")), "amount", match.index ?? 0);
  }

  const grouped = /(?<!\d)(?:\d{1,2}(?:,\d{2})+,\d{3}|\d{1,3}(?:,\d{3})+)(?:\.\d+)?(?!\d)/g;
  for (const match of answer.matchAll(grouped)) {
    take(match[0], Number(match[0].replace(/,/g, "")), "amount", match.index ?? 0);
  }

  const decimal = /(?<![\d,])(\d+\.\d+)(?!\d)/g;
  for (const match of answer.matchAll(decimal)) {
    take(match[0], Number(match[1]), "amount", match.index ?? 0);
  }

  const plain = /(?<![\d,])(\d{4,})(?!\d)/g;
  for (const match of answer.matchAll(plain)) {
    take(match[0], Number(match[1]), "amount", match.index ?? 0);
  }

  return claimed;
}

function shouldIgnore(answer: string, token: string, index: number, kind: Claimed["kind"]): boolean {
  if (kind === "percent") return false;
  const digits = token.replace(/[^\d.]/g, "");
  if (/^\d{4}$/.test(digits)) {
    const year = Number(digits);
    if (year >= 1990 && year <= 2099) return true;
  }
  const around = answer.slice(Math.max(0, index - 14), index + token.length + 14);
  if (MONTH.test(around) && !/,/.test(token) && !/\./.test(token) && token.replace(/\D/g, "").length <= 4) {
    return true;
  }
  const window = answer.slice(Math.max(0, index - 8), Math.min(answer.length, index + token.length + 3));
  const iso = window.match(/\d{4}-\d{2}(?:-\d{2})?/);
  if (iso && iso.index !== undefined) {
    const rel = index - Math.max(0, index - 8);
    if (rel >= iso.index && rel < iso.index + iso[0].length) return true;
  }
  const compact = token.replace(/,/g, "");
  if (/^\d{1,3}$/.test(compact)) return true;
  return false;
}

function collectAllowed(rows: MaskedRow[]): { amounts: number[]; percents: number[] } {
  const amounts: number[] = [];
  const percents: number[] = [];
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      const n = asNumber(value);
      if (n === null) continue;
      if (/percent|pct|rate|change/i.test(key)) percents.push(n);
      amounts.push(n);
    }
  }
  return { amounts, percents };
}

function matchesAllowed(value: number, kind: Claimed["kind"], allowed: { amounts: number[]; percents: number[] }): boolean {
  const pool = kind === "percent" ? [...allowed.percents, ...allowed.amounts] : allowed.amounts;
  return pool.some((item) => Math.abs(item - value) <= 0.01);
}

function asNumber(value: string | number | boolean | null): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value !== "string") return null;
  const text = value.replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  return Number(text);
}
