export interface StatementLine {
  txnDate: string;
  valueDate: string;
  description: string;
  refNo: string | null;
  debit: string | null;
  credit: string | null;
  balance: string;
}

export interface EnrichedLine extends StatementLine {
  channel: string;
  merchant: string;
  category: string;
  source: string | null;
  isRefund: boolean;
  isSelfTransfer: boolean;
}

export interface StatementSummary {
  debitCount: number | null;
  creditCount: number | null;
  countToken: string | null;
  closingBalance: string;
}

export interface ImportResult {
  insertedCount: number;
  skippedCount: number;
}

export const CATEGORIES = [
  "food",
  "groceries",
  "shopping",
  "travel",
  "entertainment",
  "bills",
  "cash",
  "loan_emi",
  "transfer",
  "self_transfer",
  "investment",
  "interest",
  "tax_refund",
  "fees",
  "refund",
  "other",
] as const;

export type Category = (typeof CATEGORIES)[number];
