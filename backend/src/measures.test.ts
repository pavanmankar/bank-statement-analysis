import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { enrich } from "./ingest/enrich.js";
import { isEmi, isExpense, isLoanCredit, isReceipt } from "./measures.js";
import type { StatementLine } from "./types.js";

function line(overrides: Partial<StatementLine>): StatementLine {
  return {
    txnDate: "2025-03-28",
    valueDate: "2025-03-28",
    description: "UPI/DR/1/Swiggy/HDFC/swiggy/Pay",
    refNo: null,
    debit: "400.00",
    credit: null,
    balance: "1000.00",
    ...overrides,
  };
}

describe("refund after month end", () => {
  it("keeps the March expense and excludes the April refund from every measure", () => {
    const spend = enrich(line({}));
    const refund = enrich(
      line({
        txnDate: "2025-04-02",
        valueDate: "2025-04-02",
        description: "UPI/CR/1/Swiggy/HDFC/swiggy/Refu",
        debit: null,
        credit: "400.00",
        balance: "1400.00",
      }),
    );
    assert.equal(spend.category, "food");
    assert.equal(isExpense(spend), true);
    assert.equal(refund.isRefund, true);
    assert.equal(isExpense(refund), false);
    assert.equal(isReceipt(refund), false);
  });

  it("treats an EMI repayment as a Loan/EMI expense", () => {
    const emi = enrich(line({ description: "UPI/DR/2/Fibe/SBIN/fibe/EMI", debit: "3331.00", credit: null }));
    assert.equal(emi.source, "transfer:fibe");
    assert.equal(emi.category, "loan_emi");
    assert.equal(isEmi(emi), true);
    assert.equal(isExpense(emi), true);
    assert.equal(isLoanCredit(emi), false);
  });

  it("treats a person-to-person debit as an expense", () => {
    const payee = enrich(line({ description: "UPI/DR/1/SHIVAR D/YESB/Q1/Paym", debit: "781.00", credit: null }));
    assert.equal(payee.category, "transfer");
    assert.equal(isExpense(payee), true);
    const self = enrich(line({ description: "UPI/DR/1/SELFTRANSFER/HDFC/self/Pay", debit: "100.00", credit: null }));
    assert.equal(isExpense(self), false);
  });

  it("treats a loan credit as borrowing, not a receipt", () => {
    const loan = enrich(
      line({
        description: "NEFT/LOAN DISBURSEMENT",
        debit: null,
        credit: "50000.00",
      }),
    );
    assert.equal(loan.source, "transfer:bank_credit");
    assert.equal(isLoanCredit(loan), true);
    assert.equal(isReceipt(loan), false);
    assert.equal(isEmi(loan), false);
  });
});
