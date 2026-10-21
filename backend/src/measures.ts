const NOT_EXPENSE = new Set(["self_transfer", "investment", "cash"]);

export interface MeasureLine {
  debit: string | null;
  credit: string | null;
  category: string;
  isRefund: boolean;
  isSelfTransfer: boolean;
  source?: string | null;
  description?: string;
}

export function isOutflow(line: MeasureLine): boolean {
  return line.debit !== null && !line.isRefund && !line.isSelfTransfer;
}

export function isExpense(line: MeasureLine): boolean {
  return isOutflow(line) && !NOT_EXPENSE.has(line.category);
}

export function isEmi(line: MeasureLine): boolean {
  if (!isOutflow(line)) return false;
  if (line.source === "transfer:fibe") return true;
  return line.source === "transfer:bank_credit" && /\bemi\b/i.test(line.description ?? "");
}

export function isLoanCredit(line: MeasureLine): boolean {
  return line.credit !== null && !line.isRefund && !line.isSelfTransfer && line.source === "transfer:bank_credit";
}

export function isReceipt(line: MeasureLine): boolean {
  return line.credit !== null && !line.isRefund && !line.isSelfTransfer && !isLoanCredit(line);
}
