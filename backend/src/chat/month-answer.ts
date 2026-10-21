type AnswerRow = Record<string, string | number | boolean | null>;

const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

export function formatFullMonthAnswer(rows: AnswerRow[]): string | null {
  const summary = monthSummaries(rows);
  if (summary.length < 2) return null;
  const earlier = summary[summary.length - 2];
  const later = summary[summary.length - 1];
  if (!earlier || !later) return null;
  const earlierAmount = amountOf(earlier);
  const laterAmount = amountOf(later);
  if (earlierAmount === null || laterAmount === null) return null;

  const earlierLabel = monthLabel(monthOf(earlier));
  const laterLabel = monthLabel(monthOf(later));
  const laterValue = Number(laterAmount);
  const earlierValue = Number(earlierAmount);
  const direction = laterValue > earlierValue ? "higher" : laterValue < earlierValue ? "lower" : "the same";
  const change = numeric(later.change);
  const lead = opening(
    laterLabel,
    earlierLabel,
    laterAmount,
    earlierAmount,
    direction,
    change,
    countText(later),
    countText(earlier),
  );
  const merchants = merchantParagraph(laterLabel, chargeGroups(rows, monthOf(later)));
  return [lead, merchants, "Person-to-person transfers are included in these totals. ATM cash, investments, and self-transfers are not."].filter((part) => part.length > 0).join("\n\n");
}

function opening(
  laterLabel: string,
  earlierLabel: string,
  laterAmount: string | number,
  earlierAmount: string | number,
  direction: "higher" | "lower" | "the same",
  change: number | null,
  laterCount: string | number | null,
  earlierCount: string | number | null,
): string {
  const laterBit = spendBit(laterLabel, laterAmount, laterCount, "came to");
  const earlierBit = spendBit(earlierLabel, earlierAmount, earlierCount, "was");
  if (direction === "the same") {
    const counts =
      laterCount !== null && earlierCount !== null
        ? ` ${monthOnly(laterLabel)} was ${paymentCount(laterCount)}, and ${monthOnly(earlierLabel)} was ${paymentCount(earlierCount)}.`
        : "";
    return `${laterLabel} and ${earlierLabel} came out the same, both at ${rupees(laterAmount)}.${counts}`;
  }
  if (change === null) {
    return `${laterLabel} was ${direction} than ${earlierLabel}. ${laterBit}, and ${earlierBit}.`;
  }
  const moreOrLess = direction === "higher" ? "more" : "less";
  return `You spent ${rupees(change)} ${moreOrLess} in ${laterLabel} than in ${earlierLabel}. ${laterBit}, and ${earlierBit}.`;
}

function spendBit(label: string, amount: string | number, count: string | number | null, verb: "came to" | "was"): string {
  const payments = count === null ? "" : ` over ${paymentCount(count)}`;
  return `${monthOnly(label)} ${verb} ${rupees(amount)}${payments}`;
}

function monthOnly(label: string): string {
  return label.replace(/ \d{4}$/, "");
}

function paymentCount(count: string | number): string {
  return `${count} ${Number(count) === 1 ? "payment" : "payments"}`;
}

function merchantParagraph(laterLabel: string, groups: Charge[]): string {
  if (groups.length === 0) return "";
  const month = laterLabel.replace(/ \d{4}$/, "");
  return `What stood out in ${month} was ${joinCharges(groups.map(chargePhrase))}.`;
}

interface Charge {
  name: string;
  amounts: string[];
}

function chargeGroups(rows: AnswerRow[], month: string): Charge[] {
  const lines = rows
    .filter((row) => monthOf(row) === month && typeof row.merchant === "string" && row.merchant && amountOf(row) !== null)
    .sort((left, right) => Number(amountOf(right)) - Number(amountOf(left)))
    .slice(0, 3);
  const groups: Charge[] = [];
  for (const line of lines) {
    const name = displayName(String(line.merchant));
    const amount = rupees(amountOf(line) as string | number);
    const existing = groups.find((group) => group.name.toLowerCase() === name.toLowerCase());
    if (existing) existing.amounts.push(amount);
    else groups.push({ name, amounts: [amount] });
  }
  return groups;
}

function displayName(name: string): string {
  if (/^[A-Z]{2,}$/.test(name)) return `${name.slice(0, 1)}${name.slice(1).toLowerCase()}`;
  return name;
}

function chargePhrase(group: Charge): string {
  const [first, ...rest] = group.amounts;
  if (!first || rest.length === 0) return `${group.name} at ${first ?? ""}`;
  return `${group.name} at ${first} and again at ${rest.join(" and ")}`;
}

function joinCharges(phrases: string[]): string {
  if (phrases.length <= 1) return phrases[0] ?? "";
  if (phrases.length === 2) return `${phrases[0]}, plus ${phrases[1]}`;
  return `${phrases.slice(0, -1).join(", ")}, plus ${phrases[phrases.length - 1]}`;
}

function monthSummaries(rows: AnswerRow[]): AnswerRow[] {
  const direct = rows
    .filter((row) => monthOf(row) && amountOf(row) !== null && !row.merchant)
    .sort((left, right) => monthOf(left).localeCompare(monthOf(right)));
  if (direct.length >= 2) return direct;

  const byMonth = new Map<string, { total: number; count: number }>();
  for (const row of rows) {
    const month = monthOf(row);
    const amount = amountOf(row);
    if (!month || amount === null || !row.merchant) continue;
    const current = byMonth.get(month) ?? { total: 0, count: 0 };
    current.total += Number(amount);
    const count = row.row_count;
    current.count += typeof count === "string" || typeof count === "number" ? Number(count) : 1;
    byMonth.set(month, current);
  }

  const months = [...byMonth.keys()].sort();
  return months.map((month, index) => {
    const value = byMonth.get(month);
    const previousMonth = months[index - 1];
    const previous = previousMonth ? byMonth.get(previousMonth) : undefined;
    return {
      month,
      total: (value?.total ?? 0).toFixed(2),
      row_count: String(value?.count ?? 0),
      change: previous && value ? (value.total - previous.total).toFixed(2) : null,
    };
  });
}

function monthOf(row: AnswerRow): string {
  const value = row.month ?? row.period;
  return typeof value === "string" ? value : "";
}

function amountOf(row: AnswerRow): string | number | null {
  for (const key of ["total", "exp_total", "expenses", "total_expense"]) {
    const value = row[key];
    if (typeof value === "string" || typeof value === "number") return value;
  }
  return null;
}

function countText(row: AnswerRow): string | number | null {
  const value = row.row_count;
  if (typeof value === "string" || typeof value === "number") return value;
  return null;
}

function monthLabel(period: string): string {
  const [year, month] = period.split("-");
  const name = MONTH_NAMES[Number(month) - 1];
  return name && year ? `${name} ${year}` : period;
}

function numeric(value: AnswerRow[string]): number | null {
  if (typeof value !== "string" && typeof value !== "number") return null;
  if (String(value).trim() === "") return null;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function rupees(value: string | number): string {
  const amount = Math.abs(Number(value));
  if (!Number.isFinite(amount)) return `${value} rupees`;
  const formatted = new Intl.NumberFormat("en-IN", {
    minimumFractionDigits: Number.isInteger(amount) ? 0 : 2,
    maximumFractionDigits: 2,
  }).format(amount);
  return `Rs ${formatted}`;
}
