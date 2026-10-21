import { randomUUID } from "node:crypto";
import type { QueryResultRow } from "pg";
import { readQuery, writeQuery } from "../db.js";
import { logInfo } from "../log.js";
import { createLlmClient } from "../llm/client.js";
import type { LlmClient, LlmTurn } from "../llm/types.js";
import { guardSql } from "../sql/guard.js";
import { chartFromRows, type ChartSpec } from "./chart-spec.js";
import { planDirectReply } from "./direct-reply.js";
import { gateLogResult, screenMessage } from "./gate.js";
import { maskDigits } from "./mask.js";
import { buildSystemPrompt, type DataProfile } from "./prompt.js";
import { appendTurnLog, type ToolCallLog, type VerifiedLog } from "./turn-log.js";
import { VIEW_COLUMN_HINT } from "./tool-defs.js";
import { summarizeToolRows } from "./tool-summary.js";
import { executeFixedTool } from "./fixed-tools.js";
import { rewriteInstruction, unverifiedFallback, verifyAnswer } from "./verify-answer.js";

export interface ChatRow {
  [key: string]: string | number | boolean | null;
}

export interface ChatOutcome {
  sessionId: string;
  answer: string;
  sql: string | null;
  rows: ChatRow[];
  chart: ChartSpec | null;
  fellBack: boolean;
  verified: VerifiedLog;
  toolNames: string[];
}

const MAX_TOOL_STEPS = 5;
const MAX_REPAIRS = 2;
const FORCED_FINAL = "Answer using only the query results above. If they are insufficient, say exactly what is missing.";

export async function answerQuestion(
  sessionId: string | null,
  message: string,
  llm?: LlmClient,
): Promise<ChatOutcome> {
  const started = Date.now();
  const toolCalls: ToolCallLog[] = [];
  const hasHistory = await sessionHasUserMessage(sessionId);
  screenMessage(message, hasHistory);
  logInfo(`chat question ${message}`);
  const gate = gateLogResult(message, hasHistory);

  const id = await ensureSession(sessionId);
  await writeQuery(`INSERT INTO chat_messages (session_id, role, content) VALUES ($1, 'user', $2)`, [id, message]);

  const profile = await loadProfile();
  const planned = planDirectReply(message, profile);
  if (planned) {
    const guarded = guardSql(planned.sql);
    const queried = await readQuery<QueryResultRow>(guarded);
    const plannedRows = queried.map(serializeRow);
    const answer = planned.answer(plannedRows);
    toolCalls.push({ name: "run_sql_query", sql: guarded, error: null, rowCount: plannedRows.length });
    await saveAssistant(id, answer, guarded);
    return finishTurn(id, message, gate, answer, guarded, plannedRows, false, true, toolCalls, started);
  }

  const history = await writeQuery<{ role: string; content: string }>(
    `SELECT role, content FROM chat_messages WHERE session_id = $1 ORDER BY created_at DESC LIMIT 8`,
    [id],
  );

  const turns: LlmTurn[] = history
    .reverse()
    .slice(0, -1)
    .map((item) => ({ role: item.role === "assistant" ? "model" : "user", text: item.content }));
  turns.push({ role: "user", text: message });

  const client = llm ?? createLlmClient();
  const system = buildSystemPrompt(profile);
  let sql: string | null = null;
  let rows: ChatRow[] = [];
  const seenRows: ChatRow[] = [];
  let hadToolResult = false;
  let fellBack = false;
  let text: string | null = null;
  const repairs = new Map<string, number>();

  for (let step = 0; step < MAX_TOOL_STEPS; step += 1) {
    const result = await client.step(system, turns, { temperature: 0, tools: true });
    if (!result.toolCall) {
      text = result.text;
      break;
    }

    const name = result.toolCall.name;
    const args = result.toolCall.args;
    turns.push({
      role: "model",
      toolCall: result.toolCall,
      rawParts: result.modelParts ?? undefined,
    });

    try {
      const executed = await runTool(name, args);
      hadToolResult = true;
      if (executed.sql) sql = executed.sql;
      if (executed.rows.length > 0 || rows.length === 0) rows = executed.rows;
      seenRows.push(...executed.rows);
      repairs.set(toolKey(name, args), 0);
      toolCalls.push({ name, sql: executed.sql, error: null, rowCount: executed.rows.length });
      logInfo(`sql ${executed.sql ?? name} rows ${executed.rows.length}`);
      turns.push({
        role: "user",
        toolResult: {
          name,
          payload: {
            ...summarizeToolRows(executed.rows),
            hint: "These rows already match the question. Write the final answer from them. Do not call the tool again.",
          },
        },
      });
    } catch (error) {
      hadToolResult = true;
      const reason = maskDigits(error instanceof Error ? error.message : "Query failed");
      const key = toolKey(name, args);
      const attempt = (repairs.get(key) ?? 0) + 1;
      repairs.set(key, attempt);
      const sqlText = typeof args.sql === "string" ? args.sql : null;
      toolCalls.push({ name, sql: sqlText, error: reason, rowCount: null });
      const payload: Record<string, unknown> = { error: reason, hint: VIEW_COLUMN_HINT };
      if (attempt > MAX_REPAIRS) {
        payload.hint = `${VIEW_COLUMN_HINT} This query already failed ${MAX_REPAIRS} repairs. Write a different query or answer from earlier results.`;
      }
      turns.push({
        role: "user",
        toolResult: { name, payload },
      });
    }
  }

  if ((text === null || text.trim() === "") && hadToolResult) {
    fellBack = true;
    turns.push({ role: "user", text: FORCED_FINAL });
    const forced = await client.step(system, turns, { temperature: 0, tools: false });
    text = forced.text;
  }

  let answer =
    text && text.trim().length > 0
      ? text
      : hadToolResult
        ? "The query ran. Use the result table for the figures."
        : "I could not finish that question from the transactions. Try a more specific period or metric.";

  let verified: VerifiedLog = hadToolResult ? true : "skipped";
  if (hadToolResult) {
    const extras = [profile.unknownSharePct, profile.rowCount];
    let check = verifyAnswer(answer, seenRows, extras);
    if (!check.ok) {
      turns.push({ role: "user", text: rewriteInstruction(check.unverified) });
      const retry = await client.step(system, turns, { temperature: 0, tools: false });
      const next = retry.text ?? "";
      check = verifyAnswer(next, seenRows, extras);
      if (next && check.ok) {
        answer = next;
      } else {
        answer = unverifiedFallback(seenRows);
        verified = false;
      }
    }
  }

  await saveAssistant(id, answer, sql);
  return finishTurn(id, message, gate, answer, sql, rows, fellBack, verified, toolCalls, started);
}

async function runTool(
  name: string,
  args: Record<string, unknown>,
): Promise<{ sql: string | null; rows: ChatRow[] }> {
  if (name !== "run_sql_query") {
    return executeFixedTool(name, args);
  }
  const sql = typeof args.sql === "string" ? args.sql : "";
  const guarded = guardSql(sql);
  const queried = await readQuery<QueryResultRow>(guarded);
  return { sql: guarded, rows: queried.map(serializeRow) };
}

function toolKey(name: string, args: Record<string, unknown>): string {
  return `${name}:${JSON.stringify(args)}`;
}

function finishTurn(
  sessionId: string,
  question: string,
  gate: ReturnType<typeof gateLogResult>,
  answer: string,
  sql: string | null,
  rows: ChatRow[],
  fellBack: boolean,
  verified: VerifiedLog,
  toolCalls: ToolCallLog[],
  started: number,
): ChatOutcome {
  try {
    appendTurnLog({
      at: new Date().toISOString(),
      question,
      gate,
      toolCalls,
      finalText: answer,
      fellBack,
      verified,
      ms: Date.now() - started,
    });
  } catch {
    // Logging must never fail the turn.
  }
  return {
    sessionId,
    answer,
    sql,
    rows,
    chart: chartFromRows(rows),
    fellBack,
    verified,
    toolNames: toolCalls.map((call) => call.name),
  };
}

export async function loadProfile(): Promise<DataProfile> {
  const rows = await readQuery<DataProfile>(
    `SELECT to_char(MIN(txn_date), 'YYYY-MM-DD') AS "firstDate",
            to_char(MAX(txn_date), 'YYYY-MM-DD') AS "latestDate",
            COUNT(*)::int AS "rowCount",
            COALESCE(
              ROUND(
                100.0 * COUNT(*) FILTER (WHERE merchant = 'Unknown' OR category = 'other')
                / NULLIF(COUNT(*), 0),
                1
              ),
              0
            )::float8 AS "unknownSharePct"
     FROM v_transactions`,
  );
  return rows[0] ?? { firstDate: null, latestDate: null, rowCount: 0, unknownSharePct: 0 };
}

async function sessionHasUserMessage(sessionId: string | null): Promise<boolean> {
  if (!sessionId || !/^[0-9a-f-]{36}$/i.test(sessionId)) return false;
  const rows = await writeQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM chat_messages WHERE session_id = $1 AND role = 'user'`,
    [sessionId],
  );
  return Number(rows[0]?.count ?? 0) > 0;
}

async function ensureSession(sessionId: string | null): Promise<string> {
  if (sessionId) {
    const existing = await writeQuery<{ id: string }>(`SELECT id::text AS id FROM chat_sessions WHERE id = $1`, [
      sessionId,
    ]);
    if (existing[0]?.id) {
      await writeQuery(`UPDATE chat_sessions SET updated_at = now() WHERE id = $1`, [sessionId]);
      return existing[0].id;
    }
  }
  const id = randomUUID();
  await writeQuery(`INSERT INTO chat_sessions (id) VALUES ($1)`, [id]);
  return id;
}

async function saveAssistant(sessionId: string, answer: string, sql: string | null): Promise<void> {
  await writeQuery(`INSERT INTO chat_messages (session_id, role, content, sql_text) VALUES ($1, 'assistant', $2, $3)`, [
    sessionId,
    answer,
    sql,
  ]);
}

export function serializeRow(row: QueryResultRow): ChatRow {
  const output: ChatRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) output[key] = null;
    else if (typeof value === "boolean" || typeof value === "number") output[key] = value;
    else if (value instanceof Date) output[key] = value.toISOString().slice(0, 10);
    else output[key] = String(value);
  }
  return output;
}
