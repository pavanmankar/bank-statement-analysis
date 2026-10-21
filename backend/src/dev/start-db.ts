import { readFileSync } from "node:fs";
import path from "node:path";
import EmbeddedPostgres from "embedded-postgres";

const dataDir = path.resolve(__dirname, "../../../data/pg");
const database = new EmbeddedPostgres({
  databaseDir: dataDir,
  user: "postgres",
  password: "postgres",
  port: 5432,
  persistent: true,
});

async function main(): Promise<void> {
  try {
    await database.initialise();
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists|exists/i.test(message)) throw error;
  }
  await database.start();
  try {
    await database.createDatabase("statements");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (!/already exists/i.test(message)) throw error;
  }

  const client = database.getPgClient("statements");
  await client.connect();
  const existing = await client.query<{ ready: string }>(
    "SELECT to_regclass('public.transactions')::text AS ready",
  );
  if (!existing.rows[0]?.ready) {
    const sql = readFileSync(path.resolve(__dirname, "../../../db/init.sql"), "utf8");
    await client.query(sql);
  }
  await client.end();
  process.stdout.write("Postgres is ready on port 5432\n");
  await new Promise(() => undefined);
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  process.stderr.write(`${message}\n`);
  process.exit(1);
});
