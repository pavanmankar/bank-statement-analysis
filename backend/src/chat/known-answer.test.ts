import assert from "node:assert/strict";
import test from "node:test";
import {
  asksInterestFy,
  filterSideRows,
  formatInterestAnswer,
  formatInterestFromRows,
  formatSideFromRows,
  interestFySql,
  monthWindow,
  sideStatement,
  sideStatementSql,
} from "./known-answer.js";

test("matches the FY interest chip", () => {
  assert.equal(asksInterestFy("How much interest did I earn this FY?"), true);
  assert.equal(asksInterestFy("What are my top 5 merchants this FY?"), false);
});

test("writes the FY interest total from the query row", () => {
  const answer = formatInterestFromRows(
    "How much interest did I earn this FY?",
    [{ total: "302.00" }],
    { firstDate: "2025-04-01", latestDate: "2026-04-01" },
  );
  assert.match(answer ?? "", /1 Apr 2025 to 1 Apr 2026/);
  assert.match(answer ?? "", /FY 2026-27/);
  assert.match(answer ?? "", /Rs\. 302/);
  assert.match(answer ?? "", /only covers this FY through 1 Apr 2026/);
  assert.match(answer ?? "", /does not split EMI interest/);
});

test("builds a bounded interest query for the fiscal year", () => {
  assert.equal(
    interestFySql("2026-04-01", "2027-03-31"),
    "SELECT COALESCE(SUM(amount), 0) AS total FROM v_transactions WHERE category = 'interest' AND txn_date >= DATE '2026-04-01' AND txn_date <= DATE '2027-03-31'",
  );
  assert.match(formatInterestAnswer({ firstDate: "2025-04-01", latestDate: "2026-04-01" }, "0.00"), /Rs\. 0/);
});

test("matches a credit statement for a named month", () => {
  assert.equal(sideStatement("give me credit statement for Aug 2025"), "credit");
  assert.equal(sideStatement("debit statement for August 2025"), "debit");
  assert.equal(sideStatement("show my credit card statement"), null);
  assert.deepEqual(monthWindow("give me credit statement for Aug 2025"), {
    start: "2025-08-01",
    end: "2025-08-31",
    label: "August 2025",
  });
});

test("lists credits only and says debits are excluded", () => {
  const answer = formatSideFromRows(
    "give me credit statement for Aug 2025",
    [
      { txn_date: "2025-08-04", direction: "credit", amount: "1194.00" },
      { txn_date: "2025-08-04", direction: "debit", amount: "4024.00" },
      { txn_date: "2025-08-05", direction: "credit", amount: "200.00" },
    ],
    { firstDate: "2025-04-01", latestDate: "2026-04-01" },
  );
  assert.match(answer ?? "", /2 credits totalling Rs\. 1,394/);
  assert.match(answer ?? "", /Debits are not included/);
  assert.equal(
    sideStatementSql("credit", "2025-08-01", "2025-08-31"),
    "SELECT to_char(txn_date, 'YYYY-MM-DD') AS txn_date, channel, merchant, category, direction, amount FROM v_transactions WHERE direction = 'credit' AND txn_date >= DATE '2025-08-01' AND txn_date <= DATE '2025-08-31' ORDER BY txn_date, id",
  );
  assert.equal(filterSideRows("give me credit statement for Aug 2025", [{ direction: "debit" }, { direction: "credit" }]).length, 1);
});
