export interface TableRow {
  [column: string]: string | number | boolean | null;
}

export interface ChartSpec {
  type: "bar" | "line" | "donut";
  title: string;
  xKey: string;
  yKeys: string[];
  data: Array<Record<string, string | number>>;
}

export interface ChatMessage {
  id: string;
  role: "user" | "assistant";
  content: string;
  sql: string | null;
  rows: TableRow[];
  chart: ChartSpec | null;
  pending: boolean;
  error: string | null;
}

export interface CategoryPoint {
  category: string;
  total: number;
}

export interface SpendResponse {
  from: string;
  to: string;
  rows: Array<{ category: string; total: string }>;
}

export interface ImportResponse {
  insertedCount: number;
  skippedCount: number;
}

export interface SourceTotal {
  period: string;
  source: string;
  total: string;
}

export interface CashflowTotal {
  period: string;
  credit: string;
  debit: string;
  closing: string;
}

export interface BreakdownResponse {
  from: string;
  to: string;
  grocery: SourceTotal[];
  food: SourceTotal[];
  investment: SourceTotal[];
  transferOut: SourceTotal[];
  transferIn: SourceTotal[];
  cashflow: CashflowTotal[];
}

export interface SummaryResponse {
  from: string;
  to: string;
  coverageFrom: string;
  coverageTo: string;
  coverageCount: number;
  loadedBank: string | null;
  expenses: string;
  outflow: string;
  receipts: string;
  txns: string;
  uncategorisedPct: number;
}

export interface TxnRow {
  txn_date: string;
  merchant: string;
  user_label: string | null;
  category: string;
  description: string;
  amount: string;
  direction: string;
  source: string | null;
}
