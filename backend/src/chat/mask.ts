export function maskDigits(value: string): string {
  return value.replace(/\d{9,}/g, (digits) => "*".repeat(digits.length));
}

const HIDDEN_COLUMNS = new Set(["description", "ref_no", "refno"]);

export interface MaskedRow {
  [key: string]: string | number | boolean | null;
}

export function rowsForModel(rows: MaskedRow[]): { rowCount: number; truncated: boolean; rows: MaskedRow[] } {
  return {
    rowCount: rows.length,
    truncated: rows.length >= 200,
    rows: rows.slice(0, 10).map((row) => {
      const next: MaskedRow = {};
      for (const [key, value] of Object.entries(row)) {
        if (HIDDEN_COLUMNS.has(key.toLowerCase())) continue;
        next[key] = typeof value === "string" ? maskDigits(value) : value;
      }
      return next;
    }),
  };
}
