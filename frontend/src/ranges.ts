export interface DateRange {
  from: string;
  to: string;
}

export const PRESETS = [
  { id: "month", label: "This month" },
  { id: "last-month", label: "Last month" },
  { id: "fy", label: "This FY" },
  { id: "last-fy", label: "Last FY" },
  { id: "3m", label: "Last 3 months" },
  { id: "all", label: "All" },
] as const;

export function presetRange(id: string, coverageFrom: string, coverageTo: string): DateRange {
  if (!coverageFrom || !coverageTo || id === "all") return { from: coverageFrom, to: coverageTo };
  if (id === "3m") return { from: shiftMonths(coverageTo, -2), to: coverageTo };
  if (id === "month") return clip({ from: `${coverageTo.slice(0, 7)}-01`, to: coverageTo }, coverageFrom, coverageTo);
  if (id === "last-month") return clip(previousMonth(coverageTo), coverageFrom, coverageTo);
  const fy = fiscalStart(coverageTo);
  if (id === "fy") return { from: fy, to: coverageTo };
  if (id === "last-fy") {
    const startYear = Number(fy.slice(0, 4)) - 1;
    return { from: `${startYear}-04-01`, to: `${startYear + 1}-03-31` };
  }
  return { from: coverageFrom, to: coverageTo };
}

function fiscalStart(iso: string): string {
  const year = Number(iso.slice(0, 4));
  const month = Number(iso.slice(5, 7));
  const startYear = month >= 4 ? year : year - 1;
  return `${startYear}-04-01`;
}

function previousMonth(iso: string): DateRange {
  const from = shiftMonths(iso, -1);
  const end = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1, 0));
  const month = String(end.getUTCMonth() + 1).padStart(2, "0");
  const day = String(end.getUTCDate()).padStart(2, "0");
  return { from, to: `${end.getUTCFullYear()}-${month}-${day}` };
}

function clip(range: DateRange, coverageFrom: string, coverageTo: string): DateRange {
  if (range.to < coverageFrom || range.from > coverageTo) return range;
  return {
    from: range.from < coverageFrom ? coverageFrom : range.from,
    to: range.to > coverageTo ? coverageTo : range.to,
  };
}

function shiftMonths(iso: string, months: number): string {
  const date = new Date(Date.UTC(Number(iso.slice(0, 4)), Number(iso.slice(5, 7)) - 1 + months, 1));
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${date.getUTCFullYear()}-${month}-01`;
}
