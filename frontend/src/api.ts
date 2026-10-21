import type { BreakdownResponse, ChartSpec, ChatMessage, ImportResponse, SpendResponse, SummaryResponse, TableRow, TxnRow } from "./types";

interface ChatHandlers {
  onSession: (sessionId: string) => void;
  onStatus: (message: string) => void;
  onSql: (sql: string) => void;
  onRows: (rows: TableRow[]) => void;
  onChart: (chart: ChartSpec) => void;
  onToken: (text: string) => void;
  onError: (message: string) => void;
}

export async function streamChat(sessionId: string | null, message: string, handlers: ChatHandlers): Promise<void> {
  const response = await fetch("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ sessionId, message }),
  });
  if (!response.ok || !response.body) {
    throw new Error("The chat service did not respond");
  }

  const reader = response.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  while (true) {
    const chunk = await reader.read();
    if (chunk.done) break;
    buffer += decoder.decode(chunk.value, { stream: true });
    const frames = buffer.split("\n\n");
    buffer = frames.pop() ?? "";
    for (const frame of frames) {
      dispatchFrame(frame, handlers);
    }
  }
  if (buffer.trim()) dispatchFrame(buffer, handlers);
}

export async function fetchSpending(from: string, to: string): Promise<SpendResponse> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  params.set("measure", "expense");
  const response = await fetch(`/api/spending/by-category?${params.toString()}`);
  if (!response.ok) throw new Error("Could not load the category chart");
  return (await response.json()) as SpendResponse;
}

export async function fetchBreakdown(from: string, to: string): Promise<BreakdownResponse> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const response = await fetch(`/api/spending/breakdown?${params.toString()}`);
  if (!response.ok) throw new Error("Could not load the detail charts");
  return (await response.json()) as BreakdownResponse;
}

export async function fetchSummary(from: string, to: string): Promise<SummaryResponse> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  const response = await fetch(`/api/summary?${params.toString()}`);
  if (!response.ok) throw new Error("Could not load the summary");
  return (await response.json()) as SummaryResponse;
}

export async function fetchTransactions(from: string, to: string, category: string, source: string, flow = ""): Promise<TxnRow[]> {
  const params = new URLSearchParams();
  if (from) params.set("from", from);
  if (to) params.set("to", to);
  if (category) params.set("category", category);
  if (source) params.set("source", source);
  if (flow === "debit" || flow === "credit") params.set("flow", flow);
  const response = await fetch(`/api/transactions?${params.toString()}`);
  if (!response.ok) throw new Error("Could not load transactions");
  const payload = (await response.json()) as { rows: TxnRow[] };
  return payload.rows;
}

export async function uploadStatement(file: File): Promise<ImportResponse> {
  const body = new FormData();
  body.set("file", file);
  const response = await fetch("/api/statements/upload", { method: "POST", body });
  const payload = (await response.json()) as ImportResponse & { message?: string };
  if (!response.ok) throw new Error(payload.message ?? "Upload failed");
  return payload;
}

export async function resetData(): Promise<void> {
  const response = await fetch("/api/statements/reset", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ confirm: "RESET" }),
  });
  if (!response.ok) throw new Error("Reset failed");
}

function dispatchFrame(frame: string, handlers: ChatHandlers): void {
  let event = "message";
  let data = "";
  for (const line of frame.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    if (line.startsWith("data:")) data += line.slice(5).trim();
  }
  if (!data) return;
  const parsed = JSON.parse(data) as {
    sessionId?: string;
    message?: string;
    sql?: string;
    rows?: TableRow[];
    chart?: ChartSpec;
    text?: string;
  };
  if (event === "session" && parsed.sessionId) handlers.onSession(parsed.sessionId);
  if (event === "status" && parsed.message) handlers.onStatus(parsed.message);
  if (event === "sql" && parsed.sql) handlers.onSql(parsed.sql);
  if (event === "rows" && parsed.rows) handlers.onRows(parsed.rows);
  if (event === "chart" && parsed.chart) handlers.onChart(parsed.chart);
  if (event === "token" && parsed.text) handlers.onToken(parsed.text);
  if (event === "error") handlers.onError(parsed.message ?? "Something went wrong");
}

export function emptyAssistant(): ChatMessage {
  return {
    id: crypto.randomUUID(),
    role: "assistant",
    content: "",
    sql: null,
    rows: [],
    chart: null,
    pending: true,
    error: null,
  };
}
