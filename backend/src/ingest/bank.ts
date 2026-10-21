const ISSUERS: Array<{ bank: string; pattern: RegExp }> = [
  { bank: "SBI", pattern: /\bstate\s+bank\s+of\s+india\b/i },
  { bank: "HDFC", pattern: /\bhdfc\s+bank\b/i },
  { bank: "HDFC", pattern: /\bhdfcbank\.com\b/i },
  { bank: "ICICI", pattern: /\bicici\s+bank\b/i },
  { bank: "Axis", pattern: /\baxis\s+bank\b/i },
  { bank: "Kotak", pattern: /\bkotak\s+mahindra\s+bank\b/i },
  { bank: "Yes Bank", pattern: /\byes\s+bank\b/i },
  { bank: "IDFC", pattern: /\bidfc\s+(?:first\s+)?bank\b/i },
  { bank: "Bank of Baroda", pattern: /\bbank\s+of\s+baroda\b/i },
  { bank: "PNB", pattern: /\bpunjab\s+national\s+bank\b/i },
  { bank: "Canara", pattern: /\bcanara\s+bank\b/i },
  { bank: "Union Bank", pattern: /\bunion\s+bank\s+of\s+india\b/i },
  { bank: "IndusInd", pattern: /\bindusind\s+bank\b/i },
  { bank: "Indian Bank", pattern: /\bindian\s+bank\b/i },
  { bank: "Bank of India", pattern: /\bbank\s+of\s+india\b/i },
  { bank: "SBI", pattern: /\bsbi\b(?!pos)/i },
];

const IFSC_BANKS: Record<string, string> = {
  HDFC: "HDFC",
  SBIN: "SBI",
  ICIC: "ICICI",
  UTIB: "Axis",
  KKBK: "Kotak",
  YESB: "Yes Bank",
  IDFB: "IDFC",
  BARB: "Bank of Baroda",
  PUNB: "PNB",
  CNRB: "Canara",
  UBIN: "Union Bank",
  INDB: "IndusInd",
  IDIB: "Indian Bank",
  BKID: "Bank of India",
};

const IFSC = /\b([A-Z]{4})0[A-Z0-9]{6}\b/gi;
const LABELLED_IFSC = /\bIFS\s*C?(?:\s*Code)?\s*[:.]?\s*([A-Z]{4})0[A-Z0-9]{6}/i;
const IFSC_LABEL = /\bIFS\s*C?(?:\s*Code)?\b/i;
const UPI_IFSC = /YBLUPI$|UPI$/i;
const PAYMENT_LINE =
  /\bUPI\b|UPI-|\bIMPS\b|\bNEFT\b|\bRTGS\b|\bATM\b|\bPOS\b|PAYMENT FROM|@ybl|@okaxis|@okhdfc|@paytm|YESB0YBL/i;

export function detectIssuerBank(text: string): string | null {
  const header = headerText(text);
  const letterhead = letterheadText(header);
  for (const issuer of ISSUERS) {
    if (issuer.pattern.test(letterhead)) return issuer.bank;
  }
  return labelledIfsc(header) ?? bareIfsc(letterhead);
}

function labelledIfsc(header: string): string | null {
  const adjacent = header.match(LABELLED_IFSC);
  if (adjacent?.[1]) return bankFromIfsc(adjacent[1], adjacent[0]);
  if (!IFSC_LABEL.test(header)) return null;
  return bareIfsc(letterheadText(header));
}

function bareIfsc(header: string): string | null {
  IFSC.lastIndex = 0;
  let match = IFSC.exec(header);
  while (match) {
    const bank = bankFromIfsc(match[1] ?? "", match[0], header, match.index ?? 0);
    if (bank) return bank;
    match = IFSC.exec(header);
  }
  return null;
}

function bankFromIfsc(code: string, token: string, around = token, index = 0): string | null {
  if (UPI_IFSC.test(token)) return null;
  const before = around.slice(Math.max(0, index - 1), index);
  if (/[/@-]/.test(before)) return null;
  const bank = IFSC_BANKS[code.toUpperCase()];
  return bank ?? null;
}

function letterheadText(header: string): string {
  return header
    .split(/\n/)
    .filter((line) => !isPaymentLine(line) || IFSC_LABEL.test(line))
    .join("\n");
}

function isPaymentLine(line: string): boolean {
  return PAYMENT_LINE.test(line) && !IFSC_LABEL.test(line) && !/\bhdfc\s+bank\b|\bhdfcbank\.com\b/i.test(line);
}

export function bankMismatchMessage(loaded: string, incoming: string): string {
  return occupiedSessionMessage(loaded, incoming);
}

export function occupiedSessionMessage(loaded: string | null, incoming: string | null): string {
  if (loaded && incoming) {
    return `This session already has ${loaded} transactions. Clear all transactions before loading ${incoming}.`;
  }
  if (loaded) {
    return `This session already has ${loaded} transactions. Clear all transactions before loading another statement.`;
  }
  if (incoming) {
    return `This session already has transactions. Clear all transactions before loading ${incoming}.`;
  }
  return loadedStatementMessage();
}

export function loadedStatementMessage(): string {
  return "This session already has transactions. Clear all transactions before loading another statement.";
}

export function headerText(text: string): string {
  const kept: string[] = [];
  for (const raw of text.split(/\r?\n/)) {
    if (kept.length >= 50) break;
    const line = raw.replace(/\u00a0/g, " ").trim();
    if (!line) continue;
    if (isTransactionStart(line)) break;
    kept.push(line);
  }
  return kept.join("\n");
}

function isTransactionStart(line: string): boolean {
  const dated =
    /^\d{1,2}[./-]\d{1,2}[./-]\d{2,4}/.test(line) ||
    /^\d{4}-\d{2}-\d{2}/.test(line) ||
    /^\d{1,2}\s+[A-Za-z]{3}\s+\d{2,4}/.test(line);
  if (!dated) return false;
  if (/\d+\.\d{2}/.test(line)) return true;
  return /UPI|IMPS|NEFT|RTGS|ATM|POS|NACH|\bACH\b|CHQ|SALARY/i.test(line);
}
