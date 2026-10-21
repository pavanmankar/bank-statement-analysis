import "./load-env.js";
import { Pool, type QueryResultRow } from "pg";

const statementTimeoutMs = 5000;

export const readPool = new Pool({
  connectionString: requiredEnv("DATABASE_URL"),
  statement_timeout: statementTimeoutMs,
  max: 8,
});

export const writePool = new Pool({
  connectionString: requiredEnv("DATABASE_URL_MIGRATE"),
  max: 4,
});

export async function readQuery<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await readPool.query<T>(text, values);
  return result.rows;
}

export async function writeQuery<T extends QueryResultRow>(text: string, values: unknown[] = []): Promise<T[]> {
  const result = await writePool.query<T>(text, values);
  return result.rows;
}

function requiredEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new Error(`${name} is required`);
  return value;
}
