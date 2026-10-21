import assert from "node:assert/strict";
import test from "node:test";
import { asksMerchantBreakdown, formatMerchantBreakdown, planDirectReply } from "./direct-reply.js";

const profile = { firstDate: "2025-04-01", latestDate: "2026-04-01" };

test("plans separate totals for Swiggy and groceries", () => {
  const plan = planDirectReply("How much did I spend on Swiggy and groceries?", profile);
  assert.match(plan?.sql ?? "", /swiggy/);
  assert.match(plan?.sql ?? "", /category = 'groceries'/);
  const answer = plan?.answer([{ part_0: "106", part_1: "21969.48" }]) ?? "";
  assert.match(answer, /Swiggy spending is Rs\. 106/);
  assert.match(answer, /groceries spending is Rs\. 21,969\.48/);
});

test("plans a month list for the financial year that holds the statement", () => {
  const plan = planDirectReply("What do I spend or pay per month this financial year?", profile);
  assert.match(plan?.sql ?? "", /2025-04-01/);
  assert.match(plan?.sql ?? "", /2026-03-31/);
  assert.match(plan?.sql ?? "", /loan_emi/);
  const answer =
    plan?.answer([
      { month: "2025-04", expenses: "121426", loan_emi: "0" },
      { month: "2026-03", expenses: "126128.06", loan_emi: "0" },
    ]) ?? "";
  assert.match(answer, /April 2025/);
  assert.match(answer, /March 2026/);
  assert.match(answer, /FY 2025-26/);
  assert.match(answer, /Loan\/EMI sits inside the expense total/);
});

test("reports the EMI total and refuses an interest split", () => {
  const plan = planDirectReply("How much of my EMI was interest?", profile);
  assert.match(plan?.sql ?? "", /loan_emi/);
  assert.doesNotMatch(plan?.sql ?? "", /category = 'interest'/);
  const answer = plan?.answer([{ total: "34518", row_count: "10" }]) ?? "";
  assert.match(answer, /Rs\. 34,518/);
  assert.match(answer, /no interest portion is available/);
});

test("lists every month for an afford question and withholds approval", () => {
  const plan = planDirectReply("Can I afford a new EMI of Rs. 15000?", profile);
  assert.match(plan?.sql ?? "", /receipts/);
  const answer =
    plan?.answer([
      { month: "2026-01", expenses: "100", loan_emi: "0", receipts: "50" },
      { month: "2026-02", expenses: "200", loan_emi: "10", receipts: "80" },
      { month: "2026-03", expenses: "300", loan_emi: "0", receipts: "90" },
    ]) ?? "";
  assert.match(answer, /January 2026/);
  assert.match(answer, /February 2026/);
  assert.match(answer, /March 2026/);
  assert.match(answer, /not a loan approval/);
});

test("answers am I saving with yes or no and the cash totals", () => {
  const plan = planDirectReply("am i saving?", profile);
  assert.match(plan?.sql ?? "", /is_receipt/);
  assert.match(plan?.sql ?? "", /is_outflow/);
  assert.doesNotMatch(plan?.sql ?? "", /float8/);
  const answer =
    plan?.answer([
      { receipts: "1935754.72", expenses: "1555837.82", outflow: "1927838.82", net: "7915.90", savings_rate_pct: "0.41" },
    ]) ?? "";
  assert.match(answer, /^Yes\./);
  assert.match(answer, /Money in was Rs\. 19,35,754\.72/);
  assert.match(answer, /Money out, including investments, was Rs\. 19,27,838\.82/);
  assert.match(answer, /Rs\. 7,915\.90/);
  assert.match(answer, /0\.41%/);
  assert.match(answer, /investment and is not spending/);
  assert.doesNotMatch(answer, /could not verify/);
  assert.doesNotMatch(answer, /00000/);
});

test("separates earnings from money that came in", () => {
  const plan = planDirectReply("How much did I earn, and how much came in?", profile);
  const answer = plan?.answer([{ earnings: "850", receipts: "1935754.72" }]) ?? "";
  assert.match(answer, /Rs\. 850/);
  assert.match(answer, /Rs\. 19,35,754\.72/);
  assert.match(answer, /loaded statement/);
  assert.doesNotMatch(answer, /EMI interest/);
  assert.doesNotMatch(answer, /FY 2026-27/);
});

test("says cash withdrawals are outside spending", () => {
  const plan = planDirectReply("How much cash did I withdraw, and is that in my spending total?", profile);
  assert.match(plan?.sql ?? "", /category = 'cash'/);
  assert.doesNotMatch(plan?.sql ?? "", /is_expense/);
  const answer = plan?.answer([{ total: "0", row_count: "0" }]) ?? "";
  assert.match(answer, /Cash withdrawals are Rs\. 0/);
  assert.match(answer, /not included in spending/);
});

test("reports Groww invested and the expense portion", () => {
  const plan = planDirectReply("How much did I put into Groww, and how much of that is in expenses?", profile);
  assert.match(plan?.sql ?? "", /groww/);
  assert.match(plan?.sql ?? "", /in_expenses/);
  const answer = plan?.answer([{ invested: "96001", row_count: "24", in_expenses: "0" }]) ?? "";
  assert.match(answer, /Rs\. 96,001/);
  assert.match(answer, /24 rows/);
  assert.match(answer, /Rs\. 0 of that is included in expenses/);
});

test("explains a narration without inventing a purpose", () => {
  const plan = planDirectReply("What was 50200007296561-S PAVAN0000602058414183 for?", profile);
  assert.match(plan?.sql ?? "", /50200007296561/);
  assert.match(plan?.sql ?? "", /0000602058414183/);
  assert.match(plan?.sql ?? "", / AND /);
  assert.doesNotMatch(plan?.sql ?? "", /PAVAN/);
  const answer = plan?.answer([
    { txn_date: "2025-08-31", merchant: "Example", category: "transfer", direction: "credit", amount: "8700", user_label: null },
  ]) ?? "";
  assert.match(answer, /31 Aug 2025/);
  assert.match(answer, /does not say the purpose/);
  assert.match(answer, /No payee label/);
});

test("writes a merchant breakdown from the query rows", () => {
  assert.equal(asksMerchantBreakdown("Break that down by merchant."), true);
  const answer = formatMerchantBreakdown(
    [
      { merchant: "Hotel Tuljai", total: "770" },
      { merchant: "Hotel Royal Indians", total: "540" },
    ],
    profile,
  );
  assert.match(answer ?? "", /Hotel Tuljai: Rs\. 770/);
  assert.match(answer ?? "", /Hotel Royal Indians: Rs\. 540/);
  assert.doesNotMatch(answer ?? "", /could not verify/);
});
