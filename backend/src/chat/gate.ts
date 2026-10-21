const IDENTITY_MESSAGE =
  "I can’t share account numbers, IFSC, or other account details. Those are not stored. Ask about a transaction or a total.";

const SCOPE_MESSAGE = "I can only help with transactions and calculations on your statement.";

const HARD_PII =
  /\b(account\s*numbers?|account\s*no\b|a\/c\s*no\b|ifsc|cif|aadhaar|aadhar|uidai|pan\s*cards?|pan\s*numbers?|permanent\s+account|\bpan\b|phone\s*numbers?|mobile\s*numbers?|cell\s*numbers?)\b/i;

const ASK_INTENT = /\b(what(?:'s| is)|show|tell|give|share)\b/i;
const CONTACT = /\b(e-?mail|address|phone|mobile)\b/i;
const MY_CONTACT = /\bmy\s+(e-?mail|phone|mobile)\b/i;

const ABUSE =
  /\b(fuck|fucking|fucker|shit|bitch|asshole|bastard|cunt|dick|porn|pornography|sex|nude|nudes)\b/i;

const OFF_TOPIC = /\b(weather|poem|joke|python|javascript|typescript|recipe|homework)\b/i;

const BANK_MOVEMENT =
  /\b(spend|spent|spending|expenses?|pa(?:y|id|yment|yments)|debits?|credits?|debited|credited|balance|passbook|transfers?|refunds?|outflows?|inflows?|receipts?|income|salary|earn(?:ed|ing|ings)?|sav(?:e|ed|ing|ings)|came\s+in|went\s+out|money\s+in|money\s+out|received|withdraw(?:al|als|n)?|deposits?|deposited|left\s*over|leftover|how\s+much|how\s+many|rupees?|\brs\b|cash|\batm\b|\bbank\b)\b/i;

const BANK_PRODUCT =
  /\b(loans?|\bemi\b|interest|principal|\bfd\b|\brd\b|\bsip\b|\bnps\b|\bppf\b|mutual\s+funds?|invest(?:ed|ing|ment|ments)?|demat|brokers?|credit\s+cards?|debit\s+cards?|card\s+bills?|wallets?|overdrafts?|\btax\b|\btds\b|\bgst\b|dividends?|maturity|sovereign\s+gold|eligible|afford)\b/i;

const BANK_CHANNEL =
  /\b(transactions?|upi|neft|imps|rtgs|nach|\becs\b|cheques?|narrations?|statements?|fiscals?|\bfy\b|quarters?|merchants?|payees?|categor(?:y|ies)|charges?|fees?|penalt(?:y|ies)|penal|bounces?|bounce|subscriptions?|self[-\s]?transfers?|mandates?|autopay|standing\s+instructions?|compare|breakdown|average)\b/i;

const BANK_PAYEE =
  /\b(groww|\bdhan\b|zerodha|upstox|kuvera|angel\s+one|smallcase|paytm|phonepe|gpay|google\s+pay|\bcred\b|swiggy|zomato|netflix|airtel|dmart|\bfibe\b|\biccl\b|\bcams\b|kfintech|groceries|grocery|\bfood\b|shopping|travels?|\bbills?\b|\brent\b|recharges?|hotels?|restaurants?|entertainment)\b/i;

const FOLLOW_UP = /^(what about|how about|and\b|break\b|same\b|that\b|those\b|the one|previous|by\b)|\b(existing data|this data|the table|these rows)\b|\bresult\b.{0,40}\b(data|table|statement|rows)\b/i;

const PERIOD_COMPARE =
  /\b(?:months?|quarters?|years?)\b[\s\S]{0,80}\b(?:higher|lower|high|low|more|less|greater|bigger|smaller|better|worse|increase[ds]?|decrease[ds]?|rose|fell)\b|\b(?:higher|lower|more|less|greater|bigger|smaller|better|worse|increase[ds]?|decrease[ds]?)\b[\s\S]{0,80}\b(?:months?|quarters?|years?|before|previous|prior)\b/i;

export class GateRefusalError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "GateRefusalError";
  }
}

export function isAllowed(message: string, hasHistory: boolean): boolean {
  return refusalReason(message, hasHistory) === null;
}

export type GateLogResult = "pass" | "identity" | "scope";

export function screenMessage(message: string, hasHistory: boolean): void {
  const reason = refusalReason(message, hasHistory);
  if (reason) throw new GateRefusalError(reason);
}

export function gateLogResult(message: string, hasHistory: boolean): GateLogResult {
  const reason = refusalReason(message, hasHistory);
  if (reason === IDENTITY_MESSAGE) return "identity";
  if (reason) return "scope";
  return "pass";
}

export function gateLogFromError(error: GateRefusalError): GateLogResult {
  return error.message === IDENTITY_MESSAGE ? "identity" : "scope";
}

function refusalReason(message: string, hasHistory: boolean): string | null {
  const text = message.trim();
  if (isHardPii(text) || isAskedContact(text)) return IDENTITY_MESSAGE;
  if (isNarration(text)) return null;
  if (isAbuse(text)) return SCOPE_MESSAGE;
  if (isOffTopic(text) && !isBankRelated(text)) return SCOPE_MESSAGE;
  if (isBankRelated(text) || isPeriodCompare(text)) return null;
  if (isFollowUp(text)) return hasHistory ? null : SCOPE_MESSAGE;
  return SCOPE_MESSAGE;
}

function isHardPii(message: string): boolean {
  const withoutQuotes = message.replace(/"[^"]*"/g, " ").replace(/'[^']*'/g, " ");
  return HARD_PII.test(withoutQuotes);
}

function isNarration(message: string): boolean {
  if (isHardPii(message)) return false;
  const compact = message.replace(/\s/g, "");
  if (/\d{8,}[A-Za-z]|[A-Za-z]\d{8,}/.test(compact)) return true;
  return /\b(purpose|narration)\b/i.test(message) && /\b(transaction|credit|debit|payment|transfer|upi|neft|line)\b/i.test(message);
}

function isAskedContact(message: string): boolean {
  if (MY_CONTACT.test(message)) return true;
  return CONTACT.test(message) && ASK_INTENT.test(message);
}

function isAbuse(message: string): boolean {
  return ABUSE.test(message);
}

function isOffTopic(message: string): boolean {
  return OFF_TOPIC.test(message);
}

function isBankRelated(message: string): boolean {
  return BANK_MOVEMENT.test(message) || BANK_PRODUCT.test(message) || BANK_CHANNEL.test(message) || BANK_PAYEE.test(message);
}

function isFollowUp(message: string): boolean {
  return FOLLOW_UP.test(message.trim());
}

function isPeriodCompare(message: string): boolean {
  return PERIOD_COMPARE.test(message);
}
