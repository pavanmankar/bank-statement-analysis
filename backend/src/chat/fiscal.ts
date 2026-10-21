export interface FiscalPeriod {
  label: string;
  start: string;
  end: string;
}

export interface FiscalContext {
  fy: FiscalPeriod;
  thisQuarter: FiscalPeriod;
  lastQuarter: FiscalPeriod;
}

interface Parts {
  y: number;
  m: number;
  d: number;
}

const QUARTERS = [
  { q: 1, startMonth: 4, endMonth: 6 },
  { q: 2, startMonth: 7, endMonth: 9 },
  { q: 3, startMonth: 10, endMonth: 12 },
  { q: 4, startMonth: 1, endMonth: 3 },
] as const;

export function fiscalContext(latestDate: string): FiscalContext {
  const fy = fiscalYear(latestDate);
  const thisQuarter = fiscalQuarter(latestDate);
  return { fy, thisQuarter, lastQuarter: previousQuarter(thisQuarter.start) };
}

export interface StatementYear {
  year: FiscalPeriod;
  opened: FiscalPeriod | null;
}

export function statementFinancialYear(firstDate: string | null, latestDate: string): StatementYear {
  const current = fiscalYear(latestDate);
  if (firstDate && firstDate < current.start && daysInclusive(current.start, latestDate) <= 7) {
    return { year: fiscalYear(shiftIso(current.start, -1)), opened: current };
  }
  const end = latestDate < current.end ? latestDate : current.end;
  return { year: { ...current, end }, opened: null };
}

function daysInclusive(start: string, end: string): number {
  const ms = Date.parse(`${end}T00:00:00Z`) - Date.parse(`${start}T00:00:00Z`);
  return Math.round(ms / 86400000) + 1;
}

function shiftIso(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

export function fiscalYear(latestDate: string): FiscalPeriod {
  const { y, m } = parseIso(latestDate);
  const startYear = m >= 4 ? y : y - 1;
  const endYear = startYear + 1;
  return {
    label: `FY ${startYear}-${String(endYear).slice(2)}`,
    start: iso(startYear, 4, 1),
    end: iso(endYear, 3, 31),
  };
}

export function fiscalQuarter(latestDate: string): FiscalPeriod {
  const { y, m } = parseIso(latestDate);
  const spec = QUARTERS.find((item) => m >= item.startMonth && m <= item.endMonth);
  if (!spec) throw new Error("Month is outside 1-12");
  const start = iso(y, spec.startMonth, 1);
  const end = iso(spec.endMonth < spec.startMonth ? y + 1 : y, spec.endMonth, lastDay(y, spec.endMonth));
  const fy = fiscalYear(start);
  return {
    label: `${fy.label} Q${spec.q}`,
    start,
    end,
  };
}

function previousQuarter(quarterStart: string): FiscalPeriod {
  const { y, m } = parseIso(quarterStart);
  const endDate = new Date(Date.UTC(y, m - 1, 1));
  endDate.setUTCDate(endDate.getUTCDate() - 1);
  return fiscalQuarter(endDate.toISOString().slice(0, 10));
}

function parseIso(value: string): Parts {
  const matched = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!matched) throw new Error("Date must be YYYY-MM-DD");
  return { y: Number(matched[1]), m: Number(matched[2]), d: Number(matched[3]) };
}

function iso(year: number, month: number, day: number): string {
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function lastDay(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}
