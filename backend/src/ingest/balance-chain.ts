export interface BalanceLine {
  debit: string | null;
  credit: string | null;
  balance: string;
}

export class BalanceChainError extends Error {
  readonly index: number;

  constructor(index: number) {
    super(`The running balance breaks at row ${index + 1}. This file was not imported.`);
    this.name = "BalanceChainError";
    this.index = index;
  }
}

export function assertBalanceChain(lines: BalanceLine[]): void {
  if (lines.length < 2) return;
  const parsed = lines.map((line) => ({
    effect: effectOf(line),
    balance: toPaise(line.balance),
  }));
  const oldest = scan(parsed, "oldest");
  const newest = scan(parsed, "newest");
  if (oldest.breakIndex === null || newest.breakIndex === null) return;
  const index = newest.matched > oldest.matched ? newest.breakIndex : oldest.breakIndex;
  throw new BalanceChainError(index);
}

export function toPaise(value: string): bigint {
  const trimmed = value.replace(/,/g, "").trim();
  const negative = trimmed.startsWith("-");
  const body = negative ? trimmed.slice(1) : trimmed;
  if (!/^\d+(\.\d{1,2})?$/.test(body)) {
    throw new Error("Amount is not a rupee value");
  }
  const [whole, fraction = ""] = body.split(".");
  const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  return negative ? -paise : paise;
}

function effectOf(line: BalanceLine): bigint {
  const credit = line.credit ? toPaise(line.credit) : 0n;
  const debit = line.debit ? toPaise(line.debit) : 0n;
  return credit - debit;
}

function scan(
  lines: Array<{ effect: bigint; balance: bigint }>,
  mode: "oldest" | "newest",
): { breakIndex: number | null; matched: number } {
  let matched = 0;
  if (mode === "oldest") {
    for (let index = 1; index < lines.length; index += 1) {
      const current = lines[index];
      const previous = lines[index - 1];
      if (!current || !previous) break;
      if (previous.balance + current.effect !== current.balance) return { breakIndex: index, matched };
      matched += 1;
    }
    return { breakIndex: null, matched };
  }
  for (let index = 0; index < lines.length - 1; index += 1) {
    const current = lines[index];
    const older = lines[index + 1];
    if (!current || !older) break;
    if (older.balance + current.effect !== current.balance) return { breakIndex: index, matched };
    matched += 1;
  }
  return { breakIndex: null, matched };
}
