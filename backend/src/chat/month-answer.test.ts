import assert from "node:assert/strict";
import test from "node:test";
import { formatFullMonthAnswer } from "./month-answer.js";

const rows = [
  { month: "2026-08", total: "1602.00", row_count: "5", change: null },
  { month: "2026-09", total: "2229.00", row_count: "8", change: "627.00" },
  { month: "2026-09", merchant: "Flipkart", total: "821.00" },
  { month: "2026-09", merchant: "FLIPKART", total: "509.00" },
  { month: "2026-09", merchant: "BLINKIT", total: "334.00" },
  { month: "2026-08", merchant: "Swiggy", total: "400.00" },
];

test("explains a month comparison in everyday language", () => {
  assert.equal(
    formatFullMonthAnswer(rows),
    [
      "You spent Rs 627 more in September 2026 than in August 2026. September came to Rs 2,229 over 8 payments, and August was Rs 1,602 over 5 payments.",
      "What stood out in September was Flipkart at Rs 821 and again at Rs 509, plus Blinkit at Rs 334.",
      "Person-to-person transfers are included in these totals. ATM cash, investments, and self-transfers are not.",
    ].join("\n\n"),
  );
});

test("explains the comparison from shop rows alone", () => {
  assert.equal(
    formatFullMonthAnswer([
      { month: "2026-08", merchant: "FLIPKART", total: "820.00", row_count: "3" },
      { month: "2026-08", merchant: "Flipkart", total: "782.00", row_count: "2" },
      { month: "2026-09", merchant: "Flipkart", total: "821.00", row_count: "2" },
      { month: "2026-09", merchant: "FLIPKART", total: "509.00", row_count: "1" },
      { month: "2026-09", merchant: "BLINKIT", total: "334.00", row_count: "1" },
      { month: "2026-09", merchant: "Hotel sw", total: "240.00", row_count: "1" },
      { month: "2026-09", merchant: "NETFLIX", total: "149.00", row_count: "1" },
      { month: "2026-09", merchant: "SWIGGY", total: "146.00", row_count: "1" },
      { month: "2026-09", merchant: "PANIPURI", total: "30.00", row_count: "1" },
    ]),
    [
      "You spent Rs 627 more in September 2026 than in August 2026. September came to Rs 2,229 over 8 payments, and August was Rs 1,602 over 5 payments.",
      "What stood out in September was Flipkart at Rs 821 and again at Rs 509, plus Blinkit at Rs 334.",
      "Person-to-person transfers are included in these totals. ATM cash, investments, and self-transfers are not.",
    ].join("\n\n"),
  );
});

test("says when the later month was lower", () => {
  const answer = formatFullMonthAnswer([
    { month: "2026-08", total: "1602.00", row_count: "5", change: null },
    { month: "2026-09", total: "1000.00", row_count: "1", change: "-602.00" },
  ]);
  assert.match(answer ?? "", /You spent Rs 602 less in September 2026 than in August 2026/);
  assert.match(answer ?? "", /over 1 payment/);
});
