import type { QueryResultRow } from "pg";
import { rowsForModel, type MaskedRow } from "./mask.js";

export type { MaskedRow };

export function summarizeToolRows(rows: MaskedRow[]): {
  rowCount: number;
  truncated: boolean;
  rows: MaskedRow[];
} {
  return rowsForModel(rows);
}

export function serializeQueryRow(row: QueryResultRow): MaskedRow {
  const output: MaskedRow = {};
  for (const [key, value] of Object.entries(row)) {
    if (value === null || value === undefined) output[key] = null;
    else if (typeof value === "boolean" || typeof value === "number") output[key] = value;
    else if (value instanceof Date) output[key] = value.toISOString().slice(0, 10);
    else output[key] = String(value);
  }
  return output;
}
