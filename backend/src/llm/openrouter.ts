import type { LlmClient, LlmOptions, LlmStep, LlmTurn } from "./types.js";
import { OPENROUTER_TOOLS } from "../chat/tool-defs.js";

export function createOpenRouterClient(): LlmClient {
  const key = process.env.OPENROUTER_API_KEY ?? "";
  if (!key) throw new Error("OPENROUTER_API_KEY is missing");
  const model = process.env.OPENROUTER_MODEL || "google/gemini-2.0-flash-001";
  return {
    step: (system, turns, options) => complete(key, model, system, turns, options),
  };
}

async function complete(
  key: string,
  model: string,
  system: string,
  turns: LlmTurn[],
  options?: LlmOptions,
): Promise<LlmStep> {
  const messages: Array<Record<string, unknown>> = [{ role: "system", content: system }];
  let callIndex = 0;
  for (const turn of turns) {
    if (turn.toolResult) {
      messages.push({
        role: "tool",
        tool_call_id: `call_${callIndex}`,
        content: JSON.stringify(turn.toolResult.payload),
      });
    } else if (turn.toolCall) {
      callIndex += 1;
      messages.push({
        role: "assistant",
        tool_calls: [
          {
            id: `call_${callIndex}`,
            type: "function",
            function: { name: turn.toolCall.name, arguments: JSON.stringify(turn.toolCall.args) },
          },
        ],
      });
    } else {
      messages.push({ role: turn.role === "model" ? "assistant" : "user", content: turn.text ?? "" });
    }
  }

  const toolsOn = options?.tools !== false;
  const payload: Record<string, unknown> = {
    model,
    temperature: options?.temperature ?? 0,
    messages,
  };
  if (toolsOn) payload.tools = OPENROUTER_TOOLS;

  const response = await fetch("https://openrouter.ai/api/v1/chat/completions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${key}`,
      "Content-Type": "application/json",
    },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify(payload),
  });
  const body = (await response.json()) as {
    error?: { message?: string };
    choices?: Array<{
      message?: {
        content?: string | null;
        tool_calls?: Array<{ function?: { name?: string; arguments?: string } }>;
      };
    }>;
  };
  if (!response.ok) {
    throw new Error(body.error?.message ?? `OpenRouter ${response.status}`);
  }
  const message = body.choices?.[0]?.message;
  const call = message?.tool_calls?.[0]?.function;
  if (call?.name) {
    const parsed = JSON.parse(call.arguments || "{}") as Record<string, unknown>;
    return { text: message?.content ?? null, toolCall: { name: call.name, args: parsed }, modelParts: null };
  }
  const text = message?.content?.trim() ?? "";
  return { text: text.length > 0 ? text : null, toolCall: null, modelParts: null };
}
