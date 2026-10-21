import assert from "node:assert/strict";
import { describe, it } from "node:test";
import { assertBalanceChain, BalanceChainError, toPaise } from "./balance-chain.js";

describe("balance chain", () => {
  const oldest = [
    { debit: null, credit: "100.10", balance: "100.10" },
    { debit: "40.50", credit: null, balance: "59.60" },
    { debit: "0.01", credit: null, balance: "59.59" },
  ];

  it("uses integer paise", () => {
    assert.equal(toPaise("1,00,000.10"), 10000010n);
    assert.equal(toPaise("0.01"), 1n);
  });

  it("accepts oldest-first", () => {
    assert.doesNotThrow(() => assertBalanceChain(oldest));
  });

  it("accepts newest-first", () => {
    assert.doesNotThrow(() => assertBalanceChain([...oldest].reverse()));
  });

  it("reports the break index when a row is missing", () => {
    const broken = [oldest[0], oldest[2]].filter((line) => line !== undefined);
    assert.throws(
      () => assertBalanceChain(broken),
      (error: unknown) => {
        assert.ok(error instanceof BalanceChainError);
        assert.equal(error.index, 1);
        assert.match(error.message, /row 2/);
        return true;
      },
    );
  });
});
