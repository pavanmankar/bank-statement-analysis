const MONTH = /jan(?:uary)?|feb(?:ruary)?|mar(?:ch)?|apr(?:il)?|may|jun(?:e)?|jul(?:y)?|aug(?:ust)?|sep(?:t(?:ember)?)?|oct(?:ober)?|nov(?:ember)?|dec(?:ember)?/i;

interface GroundRow {
  [key: string]: string | number | boolean | null;
}

export function numbersGrounded(answer: string, rows: GroundRow[], context: string): boolean {
  const allowed = collect(rows, context);
  const pattern = /\d[\d,]*(?:\.\d+)?/g;
  let match = pattern.exec(answer);
  while (match) {
    const token = match[0];
    const index = match.index;
    if (!isDateToken(answer, token, index)) {
      const keys = paiseKeys(token);
      if (keys && !keys.some((key) => allowed.has(key))) return false;
    }
    match = pattern.exec(answer);
  }
  return true;
}

function collect(rows: GroundRow[], context: string): Set<string> {
  const allowed = new Set<string>();
  addText(allowed, context);
  const columns = new Map<string, bigint[]>();
  for (const row of rows) {
    for (const [key, value] of Object.entries(row)) {
      const paise = valuePaise(value);
      if (paise === null) continue;
      addPaise(allowed, paise);
      const list = columns.get(key) ?? [];
      list.push(paise);
      columns.set(key, list);
    }
  }
  addPaise(allowed, BigInt(rows.length) * 100n);
  for (const values of columns.values()) {
    const total = values.reduce((sum, value) => sum + value, 0n);
    addPaise(allowed, total);
    if (values.length <= 12) {
      for (let left = 0; left < values.length; left += 1) {
        for (let right = left + 1; right < values.length; right += 1) {
          addPaise(allowed, abs(values[left] - values[right]));
        }
      }
    }
  }
  return allowed;
}

function addText(allowed: Set<string>, text: string): void {
  const pattern = /\d[\d,]*(?:\.\d+)?/g;
  let match = pattern.exec(text);
  while (match) {
    const keys = paiseKeys(match[0]);
    if (keys) keys.forEach((key) => allowed.add(key));
    match = pattern.exec(text);
  }
}

function isDateToken(answer: string, token: string, index: number): boolean {
  const digits = token.replace(/,/g, "");
  if (/^\d{4}$/.test(digits)) {
    const year = Number(digits);
    if (year >= 1990 && year <= 2099) return true;
  }
  const around = answer.slice(Math.max(0, index - 12), index + token.length + 12);
  if (MONTH.test(around)) return true;
  const window = answer.slice(Math.max(0, index - 8), Math.min(answer.length, index + token.length + 3));
  const match = window.match(/\d{4}-\d{2}(?:-\d{2})?/);
  if (!match || match.index === undefined) return false;
  const rel = index - Math.max(0, index - 8);
  return rel >= match.index && rel < match.index + match[0].length;
}

function paiseKeys(token: string): string[] | null {
  const paise = valuePaise(token);
  if (paise === null) return null;
  return [`p${paise}`, `r${paise / 100n}`, `r${(paise + 50n) / 100n}`];
}

function valuePaise(value: string | number | boolean | null | undefined): bigint | null {
  if (typeof value === "boolean" || value === null || value === undefined) return null;
  const text = String(value).replace(/,/g, "").trim();
  if (!/^-?\d+(\.\d+)?$/.test(text)) return null;
  const negative = text.startsWith("-");
  const body = negative ? text.slice(1) : text;
  const [whole, fraction = ""] = body.split(".");
  const paise = BigInt(whole) * 100n + BigInt(fraction.padEnd(2, "0").slice(0, 2));
  return negative ? -paise : paise;
}

function addPaise(allowed: Set<string>, paise: bigint): void {
  allowed.add(`p${paise}`);
  allowed.add(`r${paise / 100n}`);
  allowed.add(`r${(paise + 50n) / 100n}`);
}

function abs(value: bigint): bigint {
  return value < 0n ? -value : value;
}
