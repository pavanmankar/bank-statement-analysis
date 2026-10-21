import { readFileSync } from "node:fs";
import { createRequire } from "node:module";
import { writeQuery } from "../db.js";
import { parseStatementText } from "../ingest/parse-pdf.js";
import { insertLines } from "../ingest/store.js";

async function main(): Promise<void> {
  const pdfPath = process.argv[2];
  if (!pdfPath) throw new Error("Pass the statement PDF path");
  const require = createRequire(__filename);
  const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (data: Buffer) => Promise<{ text: string }>;
  const parsed = await pdfParse(readFileSync(pdfPath));
  const statement = parseStatementText(parsed.text);
  await writeQuery("DELETE FROM chat_messages");
  await writeQuery("DELETE FROM chat_sessions");
  await writeQuery("DELETE FROM transactions");
  const result = await insertLines(statement.lines, statement.summary);
  const range = await writeQuery<{ first: string; last: string; count: string }>(
    `SELECT to_char(MIN(txn_date), 'YYYY-MM-DD') AS first, to_char(MAX(txn_date), 'YYYY-MM-DD') AS last, COUNT(*)::text AS count FROM transactions`,
  );
  process.stdout.write(
    `Inserted ${result.insertedCount}, skipped ${result.skippedCount}. Range ${range[0]?.first} to ${range[0]?.last}, rows ${range[0]?.count}.\n`,
  );
}

main().catch((error: unknown) => {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exit(1);
});
