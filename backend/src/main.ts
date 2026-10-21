import "reflect-metadata";
import "./load-env.js";
import { NestFactory } from "@nestjs/core";
import { readFileSync } from "node:fs";
import path from "node:path";
import { AppModule } from "./app.module.js";
import { writeQuery } from "./db.js";
import { ensureSchema } from "./db/schema.js";
import { parseCsv } from "./ingest/parse-csv.js";
import { insertLines, refreshClassification } from "./ingest/store.js";

async function seedIfEmpty(): Promise<void> {
  const existing = await writeQuery<{ count: string }>(`SELECT COUNT(*)::text AS count FROM transactions`);
  if (Number(existing[0]?.count ?? 0) > 0) return;
  const csvPath = path.resolve(process.env.SEED_CSV ?? path.join(__dirname, "../../db/seed/transactions.csv"));
  const result = await insertLines(parseCsv(readFileSync(csvPath, "utf8")), null);
  process.stdout.write(`Seeded ${result.insertedCount} transactions.\n`);
}

async function bootstrap(): Promise<void> {
  await waitForDatabase();
  await ensureSchema();
  await seedIfEmpty();
  await refreshClassification();
  const app = await NestFactory.create(AppModule);
  app.enableCors({ origin: ["http://localhost:5173", "http://127.0.0.1:5173"] });
  const port = Number(process.env.PORT ?? 3000);
  await app.listen(port);
}

async function waitForDatabase(): Promise<void> {
  for (let attempt = 1; attempt <= 30; attempt += 1) {
    try {
      await writeQuery(`SELECT 1 AS ok`);
      return;
    } catch {
      await new Promise((resolve) => setTimeout(resolve, 1000));
    }
  }
  throw new Error("Database did not become ready");
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
