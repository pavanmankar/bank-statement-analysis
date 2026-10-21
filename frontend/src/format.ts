const CATEGORY_LABELS: Record<string, string> = {
  loan_emi: "Loan/EMI",
  self_transfer: "Self transfer",
  tax_refund: "Tax refund",
};

export function categoryLabel(category: string): string {
  if (category === "this range") return "This range";
  return CATEGORY_LABELS[category] ?? titleCase(category.replaceAll("_", " "));
}

const COLUMN_TITLES: Record<string, string> = {
  txn_date: "Date",
  value_date: "Value date",
  merchant: "Payee",
  user_label: "Label",
  category: "Category",
  description: "Description",
  amount: "Amount",
  direction: "Type",
  source: "Source",
  debit: "Debit",
  credit: "Credit",
  total: "Total",
  month: "Month",
  period: "Period",
};

export function columnTitle(key: string): string {
  return COLUMN_TITLES[key] ?? titleCase(key.replaceAll("_", " "));
}

function titleCase(value: string): string {
  return value.replace(/\b\w/g, (letter) => letter.toUpperCase());
}

export const inr = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  maximumFractionDigits: 0,
});

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

export function inrCompactText(value: number): string {
  const sign = value < 0 ? "-" : "";
  const abs = Math.abs(value);
  if (abs >= 1_00_00_000) return `${sign}₹${trim(abs / 1_00_00_000)}Cr`;
  if (abs >= 1_00_000) return `${sign}₹${trim(abs / 1_00_000)}L`;
  if (abs >= 1_000) return `${sign}₹${trim(abs / 1_000)}k`;
  return `${sign}₹${Math.round(abs)}`;
}

export function formatDmy(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
  const [year, month, day] = ymd.split("-");
  return `${day}/${month}/${year}`;
}

export function formatCoverage(ymd: string): string {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(ymd)) return "";
  const [year, month, day] = ymd.split("-").map(Number);
  return `${day} ${MONTHS[(month ?? 1) - 1]} ${year}`;
}

export function monthTick(period: string, from: string, to: string): string {
  const [year, month] = period.split("-");
  const name = MONTHS[Number(month) - 1] ?? period;
  const shortYear = (year ?? "").slice(2);
  const monthStart = `${period}-01`;
  const monthEnd = lastDay(period);
  if (to.slice(0, 7) === period && to < monthEnd) {
    return `${name} (to ${Number(to.slice(8))})`;
  }
  if (from.slice(0, 7) === period && from > monthStart) {
    return `${name} (from ${Number(from.slice(8))})`;
  }
  return `${name} ${shortYear}`;
}

export function monthIsPartial(period: string, from: string, to: string): boolean {
  return from > `${period}-01` || to < lastDay(period);
}

function lastDay(period: string): string {
  const [year, month] = period.split("-").map(Number);
  const date = new Date(Date.UTC(year ?? 2025, month ?? 1, 0));
  const day = String(date.getUTCDate()).padStart(2, "0");
  return `${period}-${day}`;
}

function trim(value: number): string {
  const text = value.toFixed(1);
  return text.endsWith(".0") ? text.slice(0, -2) : text;
}
