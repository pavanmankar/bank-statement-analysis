import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { chartFromRows } from "./chart-spec.js";

describe("chart spec", () => {
  it("builds a cash-movement bar when both sides are numeric", () => {
    const chart = chartFromRows([
      { month: "2025-08", credit: "100.00", debit: "40.00" },
      { month: "2025-09", credit: "80.00", debit: "20.00" },
    ]);
    assert.equal(chart?.type, "bar");
    assert.equal(chart?.title, "Cash movement");
    assert.deepEqual(chart?.yKeys, ["credit", "debit"]);
  });

  it("builds a running-balance line", () => {
    const chart = chartFromRows([
      { txn_date: "2025-01-01", balance: "100.00" },
      { txn_date: "2025-01-02", balance: "80.50" },
    ]);
    assert.equal(chart?.type, "line");
    assert.equal(chart?.title, "Running balance");
  });

  it("keeps Unknown on a category donut", () => {
    const chart = chartFromRows([
      { category: "food", total: "10.00" },
      { category: "other", total: "4.00" },
    ]);
    assert.equal(chart?.type, "donut");
    assert.equal(chart?.data.some((row) => row.category === "other"), true);
  });

  it("does not chart merchants that are already split by month", () => {
    assert.equal(
      chartFromRows([
        { month: "2026-08", merchant: "Flipkart", total: "820.00" },
        { month: "2026-09", merchant: "Blinkit", total: "334.00" },
      ]),
      null,
    );
  });

  it("falls back when a y value is not numeric", () => {
    assert.equal(
      chartFromRows([
        { category: "food", total: "ten" },
        { category: "other", total: "4.00" },
      ]),
      null,
    );
  });
});
