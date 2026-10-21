import "./load-env.js";
import { Pool, type PoolConfig, type QueryResultRow } from "pg";

const statementTimeoutMs = 5000;

export function newPgPool(connectionString: string, max: number, statementTimeout?: number): Pool {
  const config: PoolConfig = {
    connectionString,
    max,
    statement_timeout: statementTimeout,
  };
  if (needsSsl(connectionString)) config.ssl = { rejectUnauthorized: false };
  return new Pool(config);
}

export const readPool = newPgPool(requiredEnv("DATABASE_URL"), 8, statementTimeoutMs);
export const writePool = newPgPool(requiredEnv("DATABASE_URL_MIGRATE"), 4);

function needsSsl(connectionString: string): boolean {
  return /render\.com/i.test(connectionString) || /[?&]sslmode=require(?:&|$)/i.test(connectionString);
}

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
