export interface ChartRow {
  [key: string]: string | number | boolean | null;
}

export interface ChartSpec {
  type: "bar" | "line" | "donut";
  title: string;
  xKey: string;
  yKeys: string[];
  data: Array<Record<string, string | number>>;
}

export function chartFromRows(rows: ChartRow[]): ChartSpec | null {
  if (rows.length < 2) return null;
  const sample = rows[0];
  if (!sample) return null;

  const period = keyOf(sample, ["period", "month", "txn_month"]);
  const inflow = keyOf(sample, ["receipt", "receipts", "credit", "money_in"]);
  const outflow = keyOf(sample, ["outflow", "debit", "money_out"]);
  if (period && inflow && outflow) {
    return validateChart({ type: "bar", title: "Cash movement", xKey: period, yKeys: [inflow, outflow] }, rows);
  }

  const category = keyOf(sample, ["category", "merchant"]);
  const measure = keyOf(sample, ["total", "amount", "sum"]);
  const date = keyOf(sample, ["txn_date", "date"]);
  if (category && measure && !date && !period) {
    return validateChart({ type: "donut", title: "Spending by category", xKey: category, yKeys: [measure] }, rows);
  }

  const balance = keyOf(sample, ["balance"]);
  const axis = keyOf(sample, ["txn_date", "value_date", "date", "period", "month"]);
  if (axis && balance) {
    return validateChart({ type: "line", title: "Running balance", xKey: axis, yKeys: [balance] }, rows);
  }

  return null;
}

export function validateChart(
  spec: Pick<ChartSpec, "type" | "title" | "xKey" | "yKeys">,
  rows: ChartRow[],
): ChartSpec | null {
  if (rows.length < 2 || spec.yKeys.length === 0) return null;
  const data: Array<Record<string, string | number>> = [];
  for (const row of rows) {
    if (!(spec.xKey in row) || row[spec.xKey] === null) return null;
    const point: Record<string, string | number> = { [spec.xKey]: String(row[spec.xKey]) };
    for (const key of spec.yKeys) {
      if (!(key in row)) return null;
      const numeric = asNumber(row[key]);
      if (numeric === null) return null;
      point[key] = numeric;
    }
    data.push(point);
  }
  return { type: spec.type, title: spec.title, xKey: spec.xKey, yKeys: spec.yKeys, data };
}

function keyOf(row: ChartRow, candidates: string[]): string | null {
  const keys = Object.keys(row);
  for (const candidate of candidates) {
    const found = keys.find((key) => key.toLowerCase() === candidate);
    if (found) return found;
  }
  return null;
}

function asNumber(value: string | number | boolean | null | undefined): number | null {
  if (typeof value === "number" && Number.isFinite(value)) return value;
  if (typeof value === "string" && value.trim() !== "") {
    const parsed = Number(value.replace(/,/g, ""));
    return Number.isFinite(parsed) ? parsed : null;
  }
  return null;
}
