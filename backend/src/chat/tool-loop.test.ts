import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { writeQuery } from "../db.js";
import type { LlmClient, LlmStep } from "../llm/types.js";
import { answerQuestion } from "./chat.service.js";
import { GateRefusalError } from "./gate.js";

describe("tool loop", () => {
  it("repairs a bad column then answers from good SQL", async () => {
    let step = 0;
    const client: LlmClient = {
      async step(_system, _turns, options) {
        step += 1;
        assert.equal(options?.temperature, 0);
        if (step === 1) {
          assert.equal(options?.tools, true);
          return tool("SELECT missing_column FROM v_transactions");
        }
        if (step === 2) {
          return tool("SELECT 1000::float8 AS total");
        }
        return text("You spent Rs. 1,000.00 on the loaded statement.");
      },
    };
    const outcome = await answerQuestion(null, "How much did I spend on Netflix?", client);
    assert.equal(outcome.fellBack, false);
    assert.equal(outcome.verified, true);
    assert.match(outcome.answer, /1,000/);
    assert.ok(outcome.toolNames.includes("run_sql_query"));
  });

  it("forces a tools-off final pass and sets fellBack", async () => {
    let forced = false;
    const client: LlmClient = {
      async step(_system, turns, options) {
        if (options?.tools === false) {
          const last = turns.at(-1)?.text ?? "";
          if (/Answer using only the query results above/.test(last)) forced = true;
          return text("You spent Rs. 1,000.00.");
        }
        if (!turns.some((turn) => turn.toolResult)) return tool("SELECT 1000::float8 AS total");
        return { text: null, toolCall: null, modelParts: null };
      },
    };
    const outcome = await answerQuestion(null, "How much did I spend on Airtel?", client);
    assert.equal(forced, true);
    assert.equal(outcome.fellBack, true);
    assert.equal(outcome.verified, true);
    assert.match(outcome.answer, /1,000/);
  });

  it("saves the user message after the gate and before the model", async () => {
    const message = "How much did I spend on food last month?";
    let sawUser = false;
    let first = true;
    const client: LlmClient = {
      async step() {
        if (first) {
          first = false;
          const rows = await writeQuery<{ content: string }>(
            `SELECT content FROM chat_messages WHERE role = 'user' ORDER BY created_at DESC LIMIT 1`,
          );
          assert.equal(rows[0]?.content, message);
          sawUser = true;
          return tool("SELECT 1000::float8 AS total");
        }
        return text("You spent Rs. 1,000.00 on food last month.");
      },
    };
    await answerQuestion(null, message, client);
    assert.equal(sawUser, true);
  });

  it("does not save a refused question", async () => {
    const before = await writeQuery<{ count: string }>(`SELECT COUNT(*)::text AS count FROM chat_messages`);
    await assert.rejects(() => answerQuestion(null, "What is my account number and email?"), GateRefusalError);
    const after = await writeQuery<{ count: string }>(`SELECT COUNT(*)::text AS count FROM chat_messages`);
    assert.equal(Number(after[0]?.count), Number(before[0]?.count));
  });
});

function tool(sql: string): LlmStep {
  return { text: null, toolCall: { name: "run_sql_query", args: { sql } }, modelParts: null };
}

function text(value: string): LlmStep {
  return { text: value, toolCall: null, modelParts: null };
}
