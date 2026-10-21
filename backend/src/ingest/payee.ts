const RAIL = /^(UPI|IMPS|NEFT|RTGS|IFT|NACH|ACH|MMT)$/i;
const SIDE = /^(DR|CR|REV|REF|P2A|P2M|P2P)$/i;
const IFSC = /^[A-Z]{4}0[A-Z0-9]{6}$/i;
const SKIP = /^(pay|payment|from|phone|paid|via|ref|upi|imps|neft|rtgs|pos|atm|chq|cheque|inb|mob|mmt)$/i;

export function payeeFromNarration(description: string): string {
  return (
    slashRailPayee(description) ||
    hyphenUpiPayee(description) ||
    bankCreditPayee(description) ||
    posPayee(description)
  );
}

function slashRailPayee(description: string): string {
  const parts = description.split(/[/,]/).map((part) => part.trim()).filter((part) => part.length > 0);
  const start = parts.findIndex((part) => RAIL.test(part) || /\b(?:UPI|IMPS|NEFT|RTGS|IFT|NACH|ACH|MMT)$/i.test(part));
  if (start < 0) return "";
  const after = parts.slice(start + 1);
  let index = 0;
  if (after[0] && SIDE.test(after[0])) index = 1;
  while (index < after.length && isRefToken(after[index] ?? "")) index += 1;
  const candidate = after[index] ?? "";
  return usablePayee(candidate) ? displayPayee(candidate) : "";
}

function hyphenUpiPayee(description: string): string {
  const matched = /(?:^|[^A-Z])UPI-([^-]+)/i.exec(description);
  const raw = matched?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  return usablePayee(raw) ? displayPayee(raw) : "";
}

function bankCreditPayee(description: string): string {
  const neft = /(?:NEFT|RTGS|IFT)\s*(?:CR|DR)?\s*-?\s*[A-Z0-9]*-([A-Za-z][A-Za-z0-9 .]+)/i.exec(description);
  if (neft?.[1] && usablePayee(neft[1])) return displayPayee(neft[1].trim());
  const ach = /(?:ACH|NACH)\s*(?:C|D|DR|CR)?\s*-?\s*([A-Za-z][A-Za-z0-9 .]+?)(?:\s*-\d|$)/i.exec(description);
  if (ach?.[1] && usablePayee(ach[1])) return displayPayee(ach[1].trim());
  return "";
}

function posPayee(description: string): string {
  const matched =
    /(?:SBI|OTH)POS\s*\d+\s*([A-Za-z].+)$/i.exec(description) ??
    /POS[:\s-]+([A-Za-z][A-Za-z0-9 .,&']+)$/i.exec(description);
  const raw = matched?.[1]?.replace(/\s+/g, " ").trim() ?? "";
  if (!usablePayee(raw)) return "";
  return stripLocation(raw);
}

function isRefToken(part: string): boolean {
  if (IFSC.test(part) || /^\d+$/.test(part)) return true;
  if (/@/.test(part) || SKIP.test(part)) return true;
  return /^[A-Z0-9]{8,}$/.test(part) && /\d/.test(part) && !/[AEIOU]/i.test(part.slice(0, 4));
}

function usablePayee(name: string): boolean {
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (trimmed.length < 2 || /^\d+$/.test(trimmed) || SKIP.test(trimmed) || IFSC.test(trimmed) || /@/.test(trimmed)) {
    return false;
  }
  return /[A-Za-z]/.test(trimmed);
}

function displayPayee(name: string): string {
  const trimmed = name.replace(/\s+/g, " ").trim();
  if (/^selftransfer$/i.test(trimmed)) return "Self transfer";
  if (!/^[A-Z0-9 .,&'/+-]+$/.test(trimmed) || !/[A-Z]/.test(trimmed)) return trimmed;
  return trimmed.replace(/[A-Z0-9']+/g, (word) => {
    if (/^\d+$/.test(word) || (word.length <= 2 && /^[A-Z]+$/.test(word))) return word;
    return `${word.charAt(0)}${word.slice(1).toLowerCase()}`;
  });
}

const BUSINESS_WORD = /^(LTD|LIMITED|PVT|PRIVATE|INC|LLP|LLC|CO|CORP|SHOP|MART|STORE|MALL|PLAZA)$/i;
const GLUED_CITY =
  /(AMRAVATI|MUMBAI|DELHI|PUNE|NAGPUR|BANGALORE|BENGALURU|HYDERABAD|CHENNAI|KOLKATA|INDORE|NASHIK|AURANGABAD)$/i;

function stripLocation(name: string): string {
  const parts = name.split(" ");
  const last = parts.at(-1) ?? "";
  const city = GLUED_CITY.exec(last);
  if (city?.[0] && last.length - city[0].length >= 2) {
    parts[parts.length - 1] = last.slice(0, last.length - city[0].length);
    return parts.join(" ").trim();
  }
  if (parts.length >= 2 && /^[A-Z]{4,}$/.test(last) && !BUSINESS_WORD.test(last)) parts.pop();
  return parts.join(" ").trim();
}
