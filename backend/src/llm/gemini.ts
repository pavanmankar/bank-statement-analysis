import type { LlmClient, LlmOptions, LlmStep, LlmTurn } from "./types.js";
import { GEMINI_TOOLS } from "../chat/tool-defs.js";

const FALLBACK_MODELS = ["gemini-3.5-flash", "gemini-3.6-flash", "gemini-3.5-flash-lite"];

export function createGeminiClient(): LlmClient {
  const key = process.env.GEMINI_API_KEY ?? "";
  if (!key) {
    throw new Error("GEMINI_API_KEY is missing");
  }
  const preferred = process.env.GEMINI_MODEL || FALLBACK_MODELS[0];
  const models = [preferred, ...FALLBACK_MODELS.filter((name) => name !== preferred)];
  return {
    step: (system, turns, options) => generate(key, models, system, turns, options),
  };
}

async function generate(
  key: string,
  models: string[],
  system: string,
  turns: LlmTurn[],
  options?: LlmOptions,
): Promise<LlmStep> {
  let lastError = "Gemini request failed";
  for (const model of models) {
    try {
      return await callModel(key, model, system, turns, options);
    } catch (error) {
      lastError = error instanceof Error ? error.message : String(error);
      if (/API key not valid|API_KEY_INVALID/i.test(lastError)) throw new Error(lastError);
      if (!/404|NOT_FOUND|no longer available|503|429|RESOURCE_EXHAUSTED/i.test(lastError)) {
        throw new Error(lastError);
      }
    }
  }
  throw new Error(lastError);
}

async function callModel(
  key: string,
  model: string,
  system: string,
  turns: LlmTurn[],
  options?: LlmOptions,
): Promise<LlmStep> {
  const toolsOn = options?.tools !== false;
  const url = `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`;
  const body: Record<string, unknown> = {
    systemInstruction: { parts: [{ text: system }] },
    contents: turns.map(toGeminiContent),
    generationConfig: { temperature: options?.temperature ?? 0, maxOutputTokens: 2048 },
  };
  if (toolsOn) body.tools = [GEMINI_TOOLS];
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-goog-api-key": key,
    },
    signal: AbortSignal.timeout(90_000),
    body: JSON.stringify(body),
  });
  const parsed = (await response.json()) as GeminiResponse;
  if (!response.ok) {
    throw new Error(`Gemini ${response.status} (${model}): ${parsed.error?.message ?? response.statusText}`);
  }
  const parts = parsed.candidates?.[0]?.content?.parts ?? [];
  const call = parts.find((part) => part.functionCall);
  const text = parts.map((part) => part.text ?? "").join("").trim();
  const modelParts = parts.map((part) => ({ ...part }));
  if (call?.functionCall?.name) {
    const args = asArgs(call.functionCall.args);
    return {
      text: text.length > 0 ? text : null,
      toolCall: { name: call.functionCall.name, args },
      modelParts,
    };
  }
  return { text: text.length > 0 ? text : null, toolCall: null, modelParts: text ? null : modelParts };
}

function asArgs(value: unknown): Record<string, unknown> {
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  return {};
}

function toGeminiContent(turn: LlmTurn): { role: string; parts: Array<Record<string, unknown>> } {
  if (turn.rawParts && turn.rawParts.length > 0) {
    return { role: "model", parts: turn.rawParts };
  }
  if (turn.toolResult) {
    return {
      role: "user",
      parts: [
        {
          functionResponse: {
            name: turn.toolResult.name,
            response: turn.toolResult.payload,
          },
        },
      ],
    };
  }
  if (turn.toolCall) {
    return {
      role: "model",
      parts: [{ functionCall: { name: turn.toolCall.name, args: turn.toolCall.args } }],
    };
  }
  return { role: turn.role === "model" ? "model" : "user", parts: [{ text: turn.text ?? "" }] };
}

interface GeminiResponse {
  error?: { message?: string };
  candidates?: Array<{
    content?: {
      parts?: Array<{
        text?: string;
        thoughtSignature?: string;
        functionCall?: { name?: string; args?: Record<string, unknown> };
      }>;
    };
  }>;
}
