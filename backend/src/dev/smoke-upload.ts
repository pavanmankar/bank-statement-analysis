import { readFileSync } from "node:fs";
import path from "node:path";

async function main(): Promise<void> {
  const csv = readFileSync(path.resolve(__dirname, "../../../db/seed/transactions.csv"));
  const body = new FormData();
  body.set("file", new Blob([csv], { type: "text/csv" }), "transactions.csv");
  const uploaded = await fetch("http://localhost:3000/api/statements/upload", { method: "POST", body });
  const uploadJson = (await uploaded.json()) as { insertedCount?: number; skippedCount?: number; message?: string };
  process.stdout.write(`upload ${uploaded.status} ${JSON.stringify(uploadJson)}\n`);
  if (uploadJson.insertedCount !== 0 || uploadJson.skippedCount !== 513) process.exitCode = 1;

  const follow = await fetch("http://localhost:3000/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      sessionId: "e7ddc4cd-dc3b-4549-9a4b-bf004f42bd90",
      message: "What about the month before?",
    }),
  });
  const text = await follow.text();
  process.stdout.write(text);
  if (!text.includes("1000")) process.exitCode = 1;
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
