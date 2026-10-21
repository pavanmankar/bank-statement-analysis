import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { fiscalContext, fiscalQuarter, fiscalYear, statementFinancialYear } from "./fiscal.js";

describe("Indian financial year", () => {
  it("puts 31 Mar in Q4 and 1 Apr in Q1", () => {
    const march = fiscalQuarter("2025-03-31");
    const april = fiscalQuarter("2025-04-01");
    assert.equal(march.label, "FY 2024-25 Q4");
    assert.equal(march.start, "2025-01-01");
    assert.equal(march.end, "2025-03-31");
    assert.equal(april.label, "FY 2025-26 Q1");
    assert.equal(april.start, "2025-04-01");
    assert.equal(april.end, "2025-06-30");
    assert.equal(fiscalYear("2025-03-31").start, "2024-04-01");
    assert.equal(fiscalYear("2025-04-01").start, "2025-04-01");
  });

  it("uses the previous financial year when the statement only opens the next one", () => {
    const year = statementFinancialYear("2025-04-01", "2026-04-01");
    assert.equal(year.year.label, "FY 2025-26");
    assert.equal(year.year.start, "2025-04-01");
    assert.equal(year.year.end, "2026-03-31");
    assert.equal(year.opened?.label, "FY 2026-27");
  });

  it("states last quarter as the previous fiscal quarter", () => {
    const fiscal = fiscalContext("2025-09-28");
    assert.equal(fiscal.thisQuarter.start, "2025-07-01");
    assert.equal(fiscal.thisQuarter.end, "2025-09-30");
    assert.equal(fiscal.lastQuarter.start, "2025-04-01");
    assert.equal(fiscal.lastQuarter.end, "2025-06-30");
  });
});
