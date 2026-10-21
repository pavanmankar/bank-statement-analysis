import { Body, Controller, Post, Res } from "@nestjs/common";
import type { Response } from "express";
import { answerQuestion } from "./chat.service.js";
import { GateRefusalError, gateLogFromError } from "./gate.js";
import { maskDigits } from "./mask.js";
import { logInfo } from "../log.js";
import { appendTurnLog } from "./turn-log.js";

interface ChatBody {
  sessionId?: string | null;
  message?: string;
}

@Controller("api")
export class ChatController {
  @Post("chat")
  async chat(@Body() body: ChatBody, @Res() res: Response): Promise<void> {
    res.setHeader("Content-Type", "text/event-stream");
    res.setHeader("Cache-Control", "no-cache");
    res.setHeader("Connection", "keep-alive");
    res.flushHeaders();

    const send = (event: string, data: unknown): void => {
      res.write(`event: ${event}\ndata: ${JSON.stringify(data)}\n\n`);
    };

    const message = body.message?.trim() ?? "";
    if (!message) {
      send("error", { message: "Message is required" });
      res.end();
      return;
    }

    const started = Date.now();
    try {
      send("status", { message: "Reading your question" });
      const outcome = await answerQuestion(body.sessionId ?? null, message);
      send("session", { sessionId: outcome.sessionId });
      if (outcome.sql) send("sql", { sql: outcome.sql });
      if (outcome.rows.length > 0) send("rows", { rows: outcome.rows });
      send("status", { message: "Writing the answer" });
      const chunks = outcome.answer.match(/\s*\S+\s*/g) ?? [outcome.answer];
      for (const chunk of chunks) {
        send("token", { text: chunk });
      }
      if (outcome.chart) send("chart", outcome.chart);
      send("done", { ok: true });
    } catch (error) {
      if (error instanceof GateRefusalError) {
        try {
          appendTurnLog({
            at: new Date().toISOString(),
            question: message,
            gate: gateLogFromError(error),
            toolCalls: [],
            finalText: error.message,
            fellBack: false,
            verified: "skipped",
            ms: Date.now() - started,
          });
        } catch {
          // Logging must never fail the turn.
        }
        send("error", { message: error.message });
        res.end();
        return;
      }
      const text = maskFailure(error);
      logInfo(`chat failed ${text}`);
      send("error", { message: text });
    }
    res.end();
  }
}

function maskFailure(error: unknown): string {
  const text = error instanceof Error ? error.message : "Chat failed";
  return maskDigits(text);
}
