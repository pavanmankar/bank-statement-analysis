import { createGeminiClient } from "./gemini.js";
import { createOpenRouterClient } from "./openrouter.js";
import type { LlmClient } from "./types.js";

export function createLlmClient(): LlmClient {
  const provider = (process.env.LLM_PROVIDER ?? "gemini").toLowerCase();
  if (provider === "openrouter") return createOpenRouterClient();
  if (provider === "gemini") return createGeminiClient();
  throw new Error(`Unsupported LLM_PROVIDER: ${provider}`);
}
