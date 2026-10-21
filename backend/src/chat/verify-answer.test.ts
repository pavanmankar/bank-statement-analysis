import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { verifyAnswer } from "./verify-answer.js";

describe("verify-answer", () => {
  it("accepts an Indian-grouped amount from the tool result", () => {
    const result = verifyAnswer("Spend was Rs. 12,34,567.00 last month.", [{ total: 1234567 }]);
    assert.equal(result.ok, true);
  });

  it("accepts a percentage the SQL returned", () => {
    const result = verifyAnswer("Expenses rose 12.5%.", [{ percent_change: 12.5 }]);
    assert.equal(result.ok, true);
  });

  it("accepts k and L suffixes", () => {
    assert.equal(verifyAnswer("About 12k went out.", [{ total: 12000 }]).ok, true);
    assert.equal(verifyAnswer("Receipts were 1.5 L.", [{ total: 150000 }]).ok, true);
  });

  it("ignores dates, years, and 1-3 digit counts", () => {
    const result = verifyAnswer("On 2025-09-28, 5 merchants totalled Rs. 1,000.00.", [{ total: 1000 }]);
    assert.equal(result.ok, true);
  });

  it("flags a number that is not in the results", () => {
    const result = verifyAnswer("Spend was Rs. 99,999.00.", [{ total: 1000 }]);
    assert.equal(result.ok, false);
    assert.ok(result.unverified.length > 0);
  });

  it("allows a profile unknown-share percent that is not in the rows", () => {
    const result = verifyAnswer("Expenses were Rs. 1,000.00. Basis: unknown share 12.5%.", [{ total: 1000 }], [12.5]);
    assert.equal(result.ok, true);
  });
});
