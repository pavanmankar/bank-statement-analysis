export interface LlmOptions {
  temperature?: number;
  tools?: boolean;
}

export interface LlmTurn {
  role: "user" | "model";
  text?: string;
  toolCall?: { name: string; args: Record<string, unknown> };
  toolResult?: { name: string; payload: unknown };
  rawParts?: Array<Record<string, unknown>>;
}

export interface LlmStep {
  text: string | null;
  toolCall: { name: string; args: Record<string, unknown> } | null;
  modelParts: Array<Record<string, unknown>> | null;
}

export interface LlmClient {
  step(system: string, turns: LlmTurn[], options?: LlmOptions): Promise<LlmStep>;
}
