import assert from "node:assert/strict";
import test from "node:test";
import {
  applyIntentToRows,
  canAnswerLocally,
  canonicalSql,
  parseIntent,
  rowsViolate,
  sqlSatisfies,
  summarizeRows,
} from "./intent.js";

const profile = { firstDate: "2025-04-01", latestDate: "2026-04-01" };

test("rejects SQL that drops a named period or category", () => {
  const food = parseIntent("How much did I spend on food in Aug 2025?", profile);
  assert.equal(food.category, "food");
  assert.equal(food.measure, "expense");
  assert.equal(food.window?.start, "2025-08-01");
  assert.equal(
    sqlSatisfies(food, "SELECT SUM(amount) AS total FROM v_transactions WHERE is_expense"),
    false,
  );
  assert.equal(
    sqlSatisfies(
      food,
      "SELECT SUM(amount) AS total FROM v_transactions WHERE category = 'food' AND is_expense AND txn_date >= DATE '2025-08-01' AND txn_date <= DATE '2025-08-31'",
    ),
    true,
  );
});

test("repairs mixed result rows against the question", () => {
  const intent = parseIntent("give me credit statement for Aug 2025", profile);
  const mixed = [
    { txn_date: "2025-08-04", direction: "credit", category: "other", amount: "100.00" },
    { txn_date: "2025-08-04", direction: "debit", category: "food", amount: "40.00" },
    { txn_date: "2025-07-01", direction: "credit", category: "other", amount: "9.00" },
  ];
  assert.equal(rowsViolate(intent, mixed), true);
  const next = applyIntentToRows(intent, mixed);
  assert.deepEqual(
    next.map((row) => row.amount),
    ["100.00"],
  );
});

test("does not skip the model on a why or comparison question", () => {
  const intent = parseIntent("Why was the last full month higher than the one before?", profile);
  assert.equal(intent.needsModel, true);
  assert.equal(canAnswerLocally(intent), false);
});

test("builds a listing query from named filters", () => {
  const intent = parseIntent("show transactions above 5000 in Aug 2025", profile);
  assert.equal(canAnswerLocally(intent), true);
  assert.match(canonicalSql(intent), /amount > 5000/);
  assert.match(canonicalSql(intent), /2025-08-01/);
});

test("eating out is the food category, not a merchant named eating", () => {
  const intent = parseIntent("How much did I spend on eating out last month?", profile);
  assert.equal(intent.category, "food");
  assert.equal(intent.merchant, null);
  assert.equal(intent.measure, "expense");
  assert.equal(intent.window?.start, "2026-03-01");
  assert.equal(intent.window?.end, "2026-03-31");
  const sql = canonicalSql(intent);
  assert.match(sql, /category = 'food'/);
  assert.match(sql, /is_expense/);
  assert.doesNotMatch(sql, /eating/);
});

test("a named shop filters the payee, not the parent category", () => {
  const intent = parseIntent("amazon how much we spend", profile);
  assert.equal(intent.merchant, "amazon");
  assert.equal(intent.category, null);
  assert.equal(intent.measure, "expense");
  assert.equal(canAnswerLocally(intent), true);
  const sql = canonicalSql(intent);
  assert.match(sql, /merchant ILIKE '%amazon%'/);
  assert.match(sql, /grocery:amazon/);
  assert.match(sql, /is_expense/);
  assert.doesNotMatch(sql, /category = 'shopping'/);
  assert.equal(sqlSatisfies(intent, "SELECT COALESCE(SUM(amount), 0) AS total FROM v_transactions WHERE category = 'shopping' AND is_expense"), false);
});

test("summarizes a query result instead of a row count", () => {
  const text = summarizeRows([{ total: "183212.00" }], profile);
  assert.match(text ?? "", /query total is Rs\. 1,83,212/);
  assert.doesNotMatch(text ?? "", /rows are in the table/);
});
