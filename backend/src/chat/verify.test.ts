import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { numbersGrounded } from "./verify.js";

describe("answer numbers", () => {
  const rows = [{ amount: "400.00", merchant: "Swiggy" }];

  it("accepts a figure that came from the query", () => {
    assert.equal(numbersGrounded("You spent 400 rupees.", rows, ""), true);
  });

  it("rejects a figure that was not in the query", () => {
    assert.equal(numbersGrounded("You spent 999 rupees.", rows, ""), false);
  });

  it("allows a coverage date and ignores a month day", () => {
    assert.equal(
      numbersGrounded("Statement covers 5 Oct 2026. You spent 400.", rows, "covers 2026-10-05"),
      true,
    );
  });

  it("ignores an ISO month and still rejects an invented amount", () => {
    assert.equal(numbersGrounded("September 2026 (2026-09) was 400 rupees.", rows, ""), true);
    assert.equal(numbersGrounded("On 2026-09 you spent 999.", rows, ""), false);
  });
});
