import assert from "node:assert/strict";
import test from "node:test";
import { guardSql } from "./guard.js";

test("allows a select and adds a limit", () => {
  const sql = guardSql("SELECT category, SUM(amount) FROM v_transactions GROUP BY category");
  assert.match(sql, /^SELECT \* FROM \(/);
  assert.match(sql, /LIMIT 200$/);
});

test("rejects a second statement", () => {
  assert.throws(() => guardSql("SELECT 1; SELECT 2"), /one SQL statement/);
});

test("rejects writes", () => {
  assert.throws(() => guardSql("DELETE FROM transactions"), /SELECT/);
  assert.throws(() => guardSql("INSERT INTO transactions (description) VALUES ('x')"), /SELECT/);
});

test("rejects comments", () => {
  assert.throws(() => guardSql("SELECT 1 -- hi"), /comments/);
});
