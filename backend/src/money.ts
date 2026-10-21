const MONTHS = "Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Sept|Oct|Nov|Dec";
const NEXT_DATE = /^\d{1,2}[./-]\d{1,2}[./-](?:\d{4}|\d{2})(?!\d)/;
const NAMED_DATE = new RegExp(`^(\\d{1,2}[./\\-\\s]+(?:${MONTHS})[./\\-\\s]+(?:\\d{4}|\\d{2}))(?!\\d)`, "i");
const MONTH_INDEX: Record<string, string> = {
  jan: "01",
  feb: "02",
  mar: "03",
  apr: "04",
  may: "05",
  jun: "06",
  jul: "07",
  aug: "08",
  sep: "09",
  oct: "10",
  nov: "11",
  dec: "12",
};

export function parseIndianAmount(raw: string): string {
  const cleaned = raw.replace(/,/g, "").trim();
  const negative = cleaned.startsWith("-");
  const body = negative ? cleaned.slice(1) : cleaned;
  if (!/^\d+(\.\d{1,2})?$/.test(body)) {
    throw new Error(`Invalid amount: ${raw}`);
  }
  const [whole, fraction = ""] = body.split(".");
  const value = `${whole}.${fraction.padEnd(2, "0").slice(0, 2)}`;
  return negative ? `-${value}` : value;
}

export function toIsoDate(raw: string): string {
  const trimmed = raw.trim();
  const iso = /^(\d{4})-(\d{2})-(\d{2})$/.exec(trimmed);
  if (iso) return trimmed;

  const dmy = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2}|\d{4})$/.exec(trimmed);
  if (dmy?.[1] && dmy[2] && dmy[3]) {
    return `${expandYear(dmy[3])}-${dmy[2].padStart(2, "0")}-${dmy[1].padStart(2, "0")}`;
  }

  const named = new RegExp(`^(\\d{1,2})[./\\-\\s]+(${MONTHS})[./\\-\\s]+(\\d{2}|\\d{4})$`, "i").exec(trimmed);
  if (named?.[1] && named[2] && named[3]) {
    const month = MONTH_INDEX[named[2].slice(0, 3).toLowerCase()];
    if (!month) throw new Error(`Invalid date: ${raw}`);
    return `${expandYear(named[3])}-${month}-${named[1].padStart(2, "0")}`;
  }

  throw new Error(`Invalid date: ${raw}`);
}

export function consumeLeadingDates(text: string): { txnDate: string; valueDate: string; rest: string } | null {
  const first = consumeLeadingDate(text);
  if (!first) return null;
  const second = consumeLeadingDate(first.rest.replace(/^\s+/, ""));
  if (second) {
    return { txnDate: first.iso, valueDate: second.iso, rest: second.rest.trim() };
  }
  return { txnDate: first.iso, valueDate: first.iso, rest: first.rest.trim() };
}

function consumeLeadingDate(text: string): { iso: string; rest: string } | null {
  const iso = /^(\d{4}-\d{2}-\d{2})/.exec(text);
  if (iso?.[1]) return parsed(iso[1], text.slice(iso[0].length));

  const dmy4 = /^(\d{1,2}[./-]\d{1,2}[./-]\d{4})/.exec(text);
  if (dmy4?.[1]) {
    const rest = text.slice(dmy4[0].length);
    if (!/^\d/.test(rest) || NEXT_DATE.test(rest)) return parsed(dmy4[1], rest);
  }

  const dmy2 = /^(\d{1,2}[./-]\d{1,2}[./-]\d{2})/.exec(text);
  if (dmy2?.[1]) {
    const rest = text.slice(dmy2[0].length);
    if (!/^\d/.test(rest) || isGluedNumericNarration(rest)) return parsed(dmy2[1], rest);
  }

  const named = NAMED_DATE.exec(text);
  if (named?.[1]) return parsed(named[1], text.slice(named[0].length));
  return null;
}

function isGluedNumericNarration(rest: string): boolean {
  return /[A-Za-z]/.test(rest) && /(\d{2}\/\d{2}\/\d{2})(?=[\d,]+\.\d{2})/.test(rest);
}

function parsed(raw: string, rest: string): { iso: string; rest: string } | null {
  try {
    return { iso: toIsoDate(raw), rest };
  } catch {
    return null;
  }
}

function expandYear(year: string): string {
  if (year.length === 4) return year;
  return String(2000 + Number(year));
}
