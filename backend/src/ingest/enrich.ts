import { createHash } from "node:crypto";
import type { EnrichedLine, StatementLine } from "../types.js";
import { payeeFromNarration } from "./payee.js";

const INTEREST = /\bint\.?\s*pd\b|interest\s*(credit|paid|capitali[sz]ed)|\bsb\s*int\b|\bint\s*cr\b/i;
const TAX_REFUND = /itdtax|income\s*tax\s*refund|\bitd\s*refund\b|\bcbdt\b|\bit\s*refund\b|tax\s*refund/i;
const FEES = /sms\s*(alert\s*)?(charge|chg)|\bamc\b|annual\s*(maintenance|fee)|min(?:imum)?\s*bal\w*\s*(?:charge|penalty|chg)|non\s*maintenance|(?:debit\s*)?card\s*(?:fee|charge|amc)|cheque\s*book\s*(?:charge|issue)|atm\s*(?:annual|fee|charge)|processing\s*fee|return\s*charge|ecs\s*return|\bpenal\w*|\bbounce\w*|dishonou?r|atmcard\s*amc|card\s*amc|card\s*fee/i;
const CASH = /\batm\s*(?:wdl|wdr|cash|withdrawal)|\batmwdl\b|\batm\/wdr\b|\bnwd\b|\bnfs\b|cash\s*(?:wdl|wd|withdrawal)/i;
const LENDERS = /\bfibe\b|early\s*salary|earlysalary|\bemi\b|\bloan\b|disbursement|bajaj\s*fin|moneyview|kreditbee|lazypay|zestmoney|stashfin|\bcashe\b|mpokket|paysense|poonawalla|tata\s*capital|fullerton/i;
const CARD = /(hdfc|icici|sbi|axis|kotak|amex|idfc|rbl|indusind|yes)\s*(?:bank\s*)?(?:credit\s*)?card|\bcred\b|cc\s*payment|card\s*bill|credit\s*card|card\s*payment|\bcc\s*payment\b/i;
const WALLET = /paytm\s*wallet|phonepe\s*wallet|amazon\s*pay\s*(?:wallet|balance)|freecharge|mobikwik|wallet\s*(?:load|top-?\s*up|topup)/i;
const INVESTMENT = /groww|\bdhan\b|angel\s*one|angel\s*broking|zerodha|\bcoin\b|upstox|kuvera|paytm\s*money|et\s*money|indmoney|5\s*paisa|motilal|\bcams\b|kfintech|karvy|mutual\s*funds?|smallcase|bse\s*star|\bnps\b|\bppf\b|sovereign\s*gold|icici\s*prudential\s*(?:amc|mutual)|hdfc\s*(?:amc|mutual)|sbi\s*mutual|nippon|\bsip\b|\biccl\b|nse\s*clearing/i;

const CATEGORY_RULES: Array<{ pattern: RegExp; category: string }> = [
  { pattern: INTEREST, category: "interest" },
  { pattern: TAX_REFUND, category: "tax_refund" },
  { pattern: FEES, category: "fees" },
  { pattern: CASH, category: "cash" },
  { pattern: INVESTMENT, category: "investment" },
  { pattern: LENDERS, category: "loan_emi" },
  { pattern: /instamart|dmart|avenue\s*supermarts?|\bavenue\b|blinkit|grofers|bigbasket|bb\s*daily|zepto|jiomart|reliance\s*(?:fresh|smart)|more\s*retail|nature'?s\s*basket|spencer'?s?|star\s*bazaar|starbazaar|licious|freshtohome|milkbasket|country\s*delight|grocery|\bsuper\b/i, category: "groceries" },
  { pattern: /swiggy|zomato|eatsure|box8|faasos|domino'?s|pizza\s*hut|pizza|mcdonald|\bkfc\b|burger\s*king|starbucks|cafe\s*coffee\s*day|\bccd\b|haldiram|barista|chaayos|behrouz|wow\s*momo|cafe|restaurant|\bhotel\b|chai|panipuri|pani puri|tasty|devyani|burger|biryani|dhaba|bakery|tiffin/i, category: "food" },
  { pattern: /netflix|spotify|hotstar|jiocinema|prime\s*video|sonyliv|zee5|youtube\s*(?:premium|music)|apple\s*(?:music|tv)|bookmyshow|\bpvr\b|\binox\b|gaana|wynk|google\s*play|playstation|dream11/i, category: "entertainment" },
  { pattern: /flipkart|amazon|myntra|ajio|nykaa|meesho|tata\s*cliq|snapdeal|lenskart|decathlon|croma|reliance\s*digital|ikea|pepperfry|firstcry|westside|pantaloons|shoppers\s*stop|max\s*fashion/i, category: "shopping" },
  { pattern: /redbus|irctc|makemytrip|goibibo|yatra|cleartrip|ixigo|easemytrip|\buber\b|\bola\b|rapido|indigo|air\s*india|spicejet|akasa|fastag|\bnhai\b|ksrtc|msrtc|indian\s*oil|\biocl\b|bharat\s*petroleum|\bbpcl\b|\bhpcl\b|hindustan\s*petroleum|\boyo\b|airbnb|agoda|treebo/i, category: "travel" },
  { pattern: /airtel|\bjio\b|vodafone|\bbsnl\b|tata\s*play|dish\s*tv|act\s*fibernet|hathway|bescom|mseb|mahavitaran|tneb|adani\s*electricity|tata\s*power|torrent\s*power|\bbses\b|mahanagar\s*gas|indane|hp\s*gas|bharat\s*gas|property\s*tax|municipal|\blic\b|hdfc\s*life|icici\s*pru\w*\s*life|sbi\s*life|max\s*life|star\s*health|care\s*health|acko|digit\s*insurance|bajaj\s*allianz|policybazaar|bbps|bharat\s*bill|electricity|broadband|recharge|insurance|water\s*bill/i, category: "bills" },
  { pattern: /pharmeasy|netmeds|\b1mg\b|practo|apollo|pharmacy|medical|hospital|clinic|diagnostic|school|college|university|tuition|coaching/i, category: "other" },
];

export function cleanDescription(description: string): string {
  return description
    .replace(/\s+/g, " ")
    .replace(/\bAT\s+\d{4,6}(?:\s+[A-Z]{3,}){1,4}\s*$/g, "")
    .trim();
}

export function rowHash(line: StatementLine): string {
  const key = [
    line.txnDate,
    line.valueDate,
    line.description.replace(/\s+/g, " ").trim().toLowerCase(),
    line.debit ?? "",
    line.credit ?? "",
    line.balance,
  ].join("|");
  return createHash("sha256").update(key).digest("hex");
}

export function enrich(line: StatementLine): EnrichedLine {
  const description = cleanDescription(line.description);
  const selfHint = (process.env.SELF_UPI_HINT ?? "").trim();
  const isRefund = /UPI\/REVERSAL|UPI\/REV\b|\/Refu\b|\breversal\b|\brefund\b/i.test(description);
  const isSelfTransfer =
    /SELFTRANSFER/i.test(description) ||
    (selfHint.length > 0 && description.toLowerCase().includes(selfHint.toLowerCase()));

  let merchant = payeeFromNarration(description);

  let channel = "OTHER";
  if (/ITDTAX|TAX REFUND/i.test(description)) channel = "TAX_REFUND";
  else if (/INTEREST CREDIT|INT(?:EREST)?\s+PAID|INT\.?\s*CR/i.test(description)) channel = "INTEREST";
  else if (/ATMCard AMC|Card AMC/i.test(description)) channel = "CARD_FEE";
  else if (/\bPOS\b|SBIPOS|OTHPOS/i.test(description)) channel = "POS";
  else if (/ATM WDL|ATM CASH|ATM\/WDR|\bATMWDL\b/i.test(description)) channel = "ATM";
  else if (/\bIMPS\b|\bMMT\/IMPS\b/i.test(description)) channel = "IMPS";
  else if (/\bNEFT\b/i.test(description)) channel = "NEFT";
  else if (/\bRTGS\b/i.test(description)) channel = "RTGS";
  else if (/\bNACH\b|\bACH\b/i.test(description)) channel = "NACH";
  else if (/\bCHQ\b|CHEQUE/i.test(description)) channel = "CHEQUE";
  else if (/\bUPI\b/i.test(description)) channel = "UPI";

  if (!merchant) {
    if (channel === "INTEREST") merchant = "Interest";
    else if (channel === "TAX_REFUND") merchant = "Income Tax";
    else if (channel === "CARD_FEE") merchant = "Card Fee";
    else if (channel === "ATM") merchant = "ATM";
    else if (/SALARY/i.test(description)) merchant = "Employer";
    else merchant = "Unknown";
  }

  const text = `${merchant} ${description}`;
  const isCardBill = CARD.test(text);
  const isWalletTopup = WALLET.test(text);
  const isLoanEmiDebit = line.debit !== null && LENDERS.test(text);
  let category = "other";
  if (isRefund) category = "refund";
  else if (isSelfTransfer) category = "self_transfer";
  else if (isLoanEmiDebit) category = "loan_emi";
  else if (isCardBill || isWalletTopup) category = "transfer";
  else {
    const matched = CATEGORY_RULES.find((rule) => rule.pattern.test(text));
    if (matched) category = matched.category;
    else if (channel === "UPI" || channel === "NEFT" || channel === "IMPS" || channel === "RTGS" || channel === "NACH") {
      category = "transfer";
    }
  }

  return {
    ...line,
    description,
    channel,
    merchant,
    category,
    source: classifySource({ merchant, description, category, isSelfTransfer, isCardBill, isWalletTopup }),
    isRefund,
    isSelfTransfer,
  };
}

const FOOD_BRANDS: Array<{ pattern: RegExp; source: string }> = [
  { pattern: /swiggy/i, source: "food:swiggy" },
  { pattern: /zomato/i, source: "food:zomato" },
  { pattern: /domino'?s?\b/i, source: "food:dominos" },
  { pattern: /pizza\s*hut/i, source: "food:pizzahut" },
  { pattern: /\bkfc\b/i, source: "food:kfc" },
  { pattern: /mcdonald/i, source: "food:mcdonalds" },
  { pattern: /burger\s*king/i, source: "food:burgerking" },
  { pattern: /\bsubway\b/i, source: "food:subway" },
];

export function classifySource(input: {
  merchant: string;
  description: string;
  category: string;
  isSelfTransfer: boolean;
  isCardBill?: boolean;
  isWalletTopup?: boolean;
}): string | null {
  const text = `${input.merchant} ${input.description}`;
  if (input.isSelfTransfer) return "transfer:self";
  if (input.isCardBill || CARD.test(text)) return "transfer:card";
  if (input.isWalletTopup || WALLET.test(text)) return "transfer:wallet";
  if (/\bfibe\b|early\s*salary|earlysalary/i.test(text)) return "transfer:fibe";
  if (/dmart|avenue/i.test(text)) return "grocery:dmart";
  if (/blinkit/i.test(text)) return "grocery:blinkit";
  if (/flipkart/i.test(text)) return "grocery:flipkart";
  if (/\bamazon\b/i.test(text)) return "grocery:amazon";
  const foodBrand = FOOD_BRANDS.find((brand) => brand.pattern.test(text));
  if (foodBrand) return foodBrand.source;
  if (/hotel|cafe|restaurant/i.test(text)) return "food:hotel";
  if (/\bbank credit\b|\bloan\b|\bemi\b|disburs/i.test(text)) return "transfer:bank_credit";
  if (input.category === "groceries") return "grocery:other";
  if (input.category === "food") return "food:other";
  if (input.category === "loan_emi") return "transfer:bank_credit";
  if (input.category === "transfer" || input.category === "self_transfer") return "transfer:other";
  return null;
}
