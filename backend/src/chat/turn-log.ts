import { appendFileSync, mkdirSync } from "node:fs";
import path from "node:path";
import { maskDigits } from "./mask.js";

export type GateLog = "pass" | "identity" | "scope";
export type VerifiedLog = true | false | "skipped";

export interface ToolCallLog {
  name: string;
  sql: string | null;
  error: string | null;
  rowCount: number | null;
}

export interface TurnLog {
  at: string;
  question: string;
  gate: GateLog;
  toolCalls: ToolCallLog[];
  finalText: string;
  fellBack: boolean;
  verified: VerifiedLog;
  ms: number;
}

const LOG_DIR = path.resolve(__dirname, "../../../data");
const LOG_FILE = path.join(LOG_DIR, "turns.jsonl");
const HIDDEN = /description|ref_no|refno/i;

export function appendTurnLog(entry: TurnLog): void {
  mkdirSync(LOG_DIR, { recursive: true });
  const line = `${JSON.stringify(maskTurn(entry))}\n`;
  appendFileSync(LOG_FILE, line, "utf8");
}

export function maskTurn(entry: TurnLog): TurnLog {
  return {
    at: entry.at,
    question: maskDigits(entry.question),
    gate: entry.gate,
    toolCalls: entry.toolCalls.map((call) => ({
      name: call.name,
      sql: call.sql === null ? null : maskDigits(stripHiddenSql(call.sql)),
      error: call.error === null ? null : maskDigits(call.error),
      rowCount: call.rowCount,
    })),
    finalText: maskDigits(entry.finalText),
    fellBack: entry.fellBack,
    verified: entry.verified,
    ms: entry.ms,
  };
}

function stripHiddenSql(sql: string): string {
  if (HIDDEN.test(sql)) return sql.replace(/\b(description|ref_no)\b/gi, "omitted");
  return sql;
}
