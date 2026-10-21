import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { readQuery } from "../db.js";
import { executeFixedTool } from "./fixed-tools.js";

const expected = JSON.parse(
  readFileSync(path.resolve(__dirname, "../../../eval/expected.json"), "utf8"),
) as {
  rowCount: number;
  latestDate: string;
  topMerchants: Array<[string, number]>;
};

describe("fixed tools", () => {
  it("loan_readiness returns a 6-month cash-movement snapshot", async () => {
    const { rows } = await executeFixedTool("loan_readiness", {});
    assert.equal(rows.length, 1);
    const row = rows[0] ?? {};
    assert.equal(Number(row.months_covered), 6);
    if (await isSeed()) {
      assert.equal(Number(row.avg_monthly_emi), 0);
      assert.equal(Number(row.bounce_return_count), 0);
    }
  });

  it("savings_summary returns months plus a total", async () => {
    const { rows } = await executeFixedTool("savings_summary", { from: "2025-01-01", to: "2025-09-28" });
    assert.ok(rows.some((row) => String(row.month) === "total"));
    assert.ok(rows.every((row) => "receipts" in row && "outflow" in row && "net" in row));
  });

  it("top_payees groups by lower(merchant) for expenses", async () => {
    const { rows } = await executeFixedTool("top_payees", {
      from: "2025-01-01",
      to: "2025-09-28",
      limit: 5,
      measure: "expense",
    });
    assert.ok(rows.length <= 5);
    if (await isSeed()) {
      const first = expected.topMerchants[0];
      assert.equal(String(rows[0]?.merchant), first?.[0].toLowerCase());
      assert.ok(Math.abs(Number(rows[0]?.total) - (first?.[1] ?? 0)) < 0.02);
    }
  });

  it("charges_and_penalties totals AMC and fee rows", async () => {
    const { rows } = await executeFixedTool("charges_and_penalties", { from: "2025-01-01", to: "2025-09-28" });
    const total = rows.find((row) => String(row.month) === "total");
    if (await isSeed()) {
      assert.ok(total);
      assert.ok(Math.abs(Number(total?.total) - 236) < 0.02);
    }
  });

  it("compare_periods computes difference and percent in SQL", async () => {
    const { rows } = await executeFixedTool("compare_periods", {
      measure: "expense",
      fromA: "2025-07-01",
      toA: "2025-07-31",
      fromB: "2025-08-01",
      toB: "2025-08-31",
    });
    assert.equal(rows.length, 1);
    assert.ok("difference" in (rows[0] ?? {}));
    assert.ok("percent_change" in (rows[0] ?? {}));
  });

  it("recurring_payments finds stable outflow merchants", async () => {
    const { rows } = await executeFixedTool("recurring_payments", {});
    if (await isSeed()) {
      assert.ok(rows.some((row) => String(row.merchant) === "netflix"));
    }
  });
});

async function isSeed(): Promise<boolean> {
  const rows = await readQuery<{ n: string; latest: string }>(
    `SELECT COUNT(*)::text AS n, to_char(MAX(txn_date), 'YYYY-MM-DD') AS latest FROM v_transactions`,
  );
  return Number(rows[0]?.n) === expected.rowCount && rows[0]?.latest === expected.latestDate;
}
