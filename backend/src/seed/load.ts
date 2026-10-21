import { readFileSync } from "node:fs";
import path from "node:path";
import { writeQuery } from "../db.js";
import { parseCsv } from "../ingest/parse-csv.js";
import { insertLines } from "../ingest/store.js";

async function main(): Promise<void> {
  const csvPath = path.resolve(process.env.SEED_CSV ?? path.join(__dirname, "../../../db/seed/transactions.csv"));
  const existing = await writeQuery<{ count: string }>(`SELECT COUNT(*)::text AS count FROM transactions`);
  if (Number(existing[0]?.count ?? 0) > 0 && process.env.SEED_FORCE !== "1") {
    process.stdout.write("Transactions already loaded. Set SEED_FORCE=1 to append the seed again.\n");
    return;
  }
  const result = await insertLines(parseCsv(readFileSync(csvPath, "utf8")), null);
  process.stdout.write(`Inserted ${result.insertedCount}, skipped ${result.skippedCount}.\n`);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
