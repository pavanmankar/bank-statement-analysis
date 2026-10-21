import assert from "node:assert/strict";
import test from "node:test";
import { enrich } from "./enrich.js";
import { isExpense, isOutflow } from "../measures.js";
import { parseCsv } from "./parse-csv.js";
import { assertPdfHasText, assertSummary, parseStatementText, pdfFailureMessage } from "./parse-pdf.js";

const FIXTURE = `
Account Number 999
01/01/2025 01/01/2025 WDL TFR
UPI/DR/269804000725/Flipkart/UTIB/FKRT/Paymen
0097693162093 AT 02147
CHANDUR BAZAR
- 1,002.00 - 3,44,404.59
03/01/2025 03/01/2025 DEP TFR
UPI/CR/661861302438/Employer/HDFC/pay/Paym
-- 1 of 2 --
Balance
- - 56,000.00 4,00,404.59
18/08/2025 18/08/2025 CHQ TRFR FROM
0032474162205 OF SOMEONE AT 02147
CHANDUR BAZAR
639251 - 50,300.00 4,50,704.59
Page no.
`;

test("parses debit, credit, and cheque lines and skips the header", () => {
  const { lines } = parseStatementText(FIXTURE);
  assert.equal(lines.length, 3);
  assert.equal(lines[0]?.txnDate, "2025-01-01");
  assert.equal(lines[0]?.debit, "1002.00");
  assert.equal(lines[0]?.credit, null);
  assert.equal(lines[0]?.balance, "344404.59");
  assert.equal(lines[1]?.credit, "56000.00");
  assert.equal(lines[1]?.debit, null);
  assert.equal(lines[2]?.refNo, "639251");
  assert.equal(lines[2]?.credit, "50300.00");
  assert.match(lines[0]?.description ?? "", /CHANDUR BAZAR/);
  assert.doesNotMatch(enrich(lines[0] as NonNullable<(typeof lines)[0]>).description, /CHANDUR BAZAR/);
});

test("treats mutual-fund platforms as investments", () => {
  const base = {
    txnDate: "2026-03-07",
    valueDate: "2026-03-07",
    refNo: null,
    credit: null,
    balance: "1000.00",
    debit: "1000.00",
  };
  const clearing = enrich({
    ...base,
    description: "UPI-INDIAN CLEARING CORP-MUTUALFUNDS.ELE",
  });
  assert.equal(clearing.category, "investment");
  assert.equal(isExpense(clearing), false);
  assert.equal(enrich({ ...base, description: "UPI-GROWW-GROWW.PAY@YBL" }).category, "investment");
  assert.equal(enrich({ ...base, description: "UPI-DHAN-DHAN.PAY@YBL" }).category, "investment");
  assert.equal(enrich({ ...base, description: "UPI-ANGEL ONE-ANGELONE.PAY@YBL" }).category, "investment");
  assert.equal(enrich({ ...base, description: "UPI-ZERODHA-ZERODHA.PAY@YBL" }).category, "investment");
  assert.equal(enrich({ ...base, description: "UPI-SMALLCASE-SMALLCASE.PAY@YBL" }).category, "investment");
  assert.equal(enrich({ ...base, description: "NACH-NPS TRUST-CONTRIBUTION" }).category, "investment");
  assert.equal(enrich({ ...base, description: "UPI-ICCL-NSE CLEARING" }).category, "investment");
});

test("covers loans, cards, wallets, fees, and the other merchant groups", () => {
  const base = {
    txnDate: "2026-03-07",
    valueDate: "2026-03-07",
    refNo: null,
    credit: null,
    balance: "1000.00",
    debit: "1000.00",
  };
  const loan = enrich({ ...base, description: "UPI-MONEYVIEW-MONEYVIEW.PAY@YBL" });
  assert.equal(loan.category, "loan_emi");
  assert.equal(loan.source, "transfer:bank_credit");
  const card = enrich({ ...base, description: "UPI-CRED-CRED.CLUB@YBL" });
  assert.equal(card.category, "transfer");
  assert.equal(card.source, "transfer:card");
  const wallet = enrich({ ...base, description: "UPI-MOBIKWIK-MOBIKWIK.PAY@YBL" });
  assert.equal(wallet.category, "transfer");
  assert.equal(wallet.source, "transfer:wallet");
  assert.equal(enrich({ ...base, description: "SMS ALERT CHARGE" }).category, "fees");
  assert.equal(enrich({ ...base, description: "ATM ANNUAL FEE" }).category, "fees");
  assert.equal(enrich({ ...base, description: "ATM WDL ATM CASH 3017" }).category, "cash");
  assert.equal(enrich({ ...base, description: "UPI-LICIOUS-LICIOUS.PAY@YBL" }).category, "groceries");
  assert.equal(enrich({ ...base, description: "UPI-BOOKMYSHOW-BOOKMYSHOW.PAY@YBL" }).category, "entertainment");
  assert.equal(enrich({ ...base, description: "UPI-AMAZON PRIME VIDEO-AMZN.PAY@YBL" }).category, "entertainment");
  assert.equal(enrich({ ...base, description: "UPI-MAKEMYTRIP-MAKEMYTRIP.PAY@YBL" }).category, "travel");
  assert.equal(enrich({ ...base, description: "UPI-PANTALOONS-PANTALOONS.PAY@YBL" }).category, "shopping");
  assert.equal(enrich({ ...base, description: "UPI-PHARMEASY-PHARMEASY.PAY@YBL" }).category, "other");
  assert.equal(enrich({ ...base, description: "UPI-APOLLO PHARMACY-APOLLO.PAY@YBL" }).category, "other");
});

test("categories a flipkart upi debit", () => {
  const { lines } = parseStatementText(FIXTURE);
  const first = lines[0];
  assert.ok(first);
  const enriched = enrich(first);
  assert.equal(enriched.merchant, "Flipkart");
  assert.equal(enriched.category, "shopping");
  assert.equal(enriched.source, "grocery:flipkart");
  assert.equal(enriched.channel, "UPI");
  assert.equal(enriched.isRefund, false);
});

test("assigns grocery, food, and transfer sources automatically", () => {
  const base = {
    txnDate: "2026-10-05",
    valueDate: "2026-10-05",
    refNo: null,
    credit: null,
    balance: "1000.00",
  };
  const fibe = enrich({ ...base, description: "UPI/DR/1/Fibe/ICIC/earlysalar/Pay", debit: "3331.00" });
  assert.equal(fibe.source, "transfer:fibe");
  assert.equal(fibe.category, "loan_emi");
  assert.equal(
    enrich({ ...base, description: "NEFT LOAN DISBURSEMENT FROM BANK", debit: null, credit: "10000.00" }).source,
    "transfer:bank_credit",
  );
  assert.equal(
    enrich({ ...base, description: "UPI/DR/1/GANGA/INDB/bajajpay.6/Paym", debit: "30.00" }).source,
    "transfer:other",
  );
  assert.equal(
    enrich({ ...base, description: "UPI/DR/1/SELFTRANSFER/HDFC/self/Pay", debit: "100.00" }).source,
    "transfer:self",
  );
  assert.equal(
    enrich({ ...base, description: "UPI/DR/1/CHAI BUCKS/YESB/Q1/Pay", debit: "90.00" }).source,
    "food:other",
  );
  assert.equal(
    enrich({ ...base, description: "UPI/DR/1/SWIGGY/ICIC/upiswiggy/Pay", debit: "146.00" }).source,
    "food:swiggy",
  );
  assert.equal(
    enrich({ ...base, description: "UPI/DR/1/ZOMATO/HDFC/zomato/Pay", debit: "240.00" }).source,
    "food:zomato",
  );
  assert.equal(
    enrich({ ...base, description: "UPI/DR/1/DOMINOS PIZZA/HDFC/dominos/Pay", debit: "500.00" }).source,
    "food:dominos",
  );
  assert.equal(
    enrich({ ...base, description: "POS ATM PURCH SBIPOS006518635359PIZZA HUT AMRAVATI", debit: "700.00" }).source,
    "food:pizzahut",
  );
  assert.equal(
    enrich({ ...base, description: "UPI/DR/1/STAR BAZ/HDFC/starbazaar/Paym", debit: "909.00" }).source,
    "grocery:other",
  );
});

test("counts eating out and supermarkets from the narration", () => {
  const base = {
    txnDate: "2026-05-20",
    valueDate: "2026-05-20",
    refNo: null,
    credit: null,
    balance: "1000.00",
  };
  assert.equal(
    enrich({ ...base, description: "UPI/DR/1/CHAI BUCKS/YESB/Q1/Pay", debit: "90.00" }).category,
    "food",
  );
  assert.equal(
    enrich({ ...base, description: "UPI/DR/1/STAR BAZ/HDFC/starbazaar/Paym", debit: "909.00" }).category,
    "groceries",
  );
  const shop = enrich({
    ...base,
    description: "POS ATM PURCH OTHPOS 1 M S SHRADDHA FAMILY SH",
    debit: "100.00",
  });
  assert.equal(shop.category, "other");
  assert.equal(shop.merchant, "M S SHRADDHA FAMILY SH");
  assert.equal(enrich({ ...base, description: "ATM WDL ATM CASH 3017", debit: "5000.00" }).category, "cash");
});

test("reads payees from common upi, imps, and neft narrations", () => {
  const base = {
    txnDate: "2026-02-03",
    valueDate: "2026-02-03",
    refNo: null,
    credit: null,
    balance: "1000.00",
  };
  assert.equal(
    enrich({ ...base, description: "UPI-FLIPKART-FLIPKART.HYPG@YESB-PAYMENT FROM PHONE", debit: "232.00" }).merchant,
    "Flipkart",
  );
  assert.equal(
    enrich({ ...base, description: "UPI-FLIPKART PAYMENTS-PAYTM-56505013@PTYBL-PAYMENT FROM PHONE", debit: "378.00" })
      .merchant,
    "Flipkart Payments",
  );
  assert.equal(
    enrich({ ...base, description: "UPI-FLIPKART INTERNET PR-SETU.FLIPKART@HDFC", debit: "100.00" }).merchant,
    "Flipkart Internet PR",
  );
  assert.equal(
    enrich({ ...base, description: "UPI/P2A/123456789012/AMAZON/XX/Pay", debit: "200.00" }).merchant,
    "Amazon",
  );
  assert.equal(
    enrich({ ...base, description: "UPI/Swiggy/pay@ybl/ICICI", debit: "146.00" }).merchant,
    "Swiggy",
  );
  assert.equal(
    enrich({ ...base, description: "MMT/IMPS/312345678901/AMAZON PAY/XX", debit: "99.00" }).merchant,
    "Amazon Pay",
  );
  assert.equal(
    enrich({
      ...base,
      description: "NEFT CR-ICIC0099999-NEXTBILLION TECHNOLOGY PRIVATE LIMITED CLIENT ACCO-TEST",
      debit: null,
      credit: "10000.00",
    }).merchant,
    "Nextbillion Technology Private Limited Client Acco",
  );
});

test("reads a spaced debit-credit-balance row used by several banks", () => {
  const { lines } = parseStatementText(`
01-04-2025 UPI/SWIGGY/pay@ybl 400.00 0.00 9,600.00
02-04-2025 NEFT CR-HDFC0001234-SALARY 0.00 50,000.00 59,600.00
`);
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.debit, "400.00");
  assert.equal(lines[1]?.credit, "50000.00");
  assert.equal(enrich(lines[0] as NonNullable<(typeof lines)[0]>).merchant, "Swiggy");
});

test("uses the shop name on a card purchase when there is no upi payee", () => {
  const base = {
    txnDate: "2026-05-20",
    valueDate: "2026-05-20",
    refNo: null,
    credit: null,
    balance: "1000.00",
  };
  const avenue = enrich({
    ...base,
    description: "POS ATM PURCH SBIPOS006518635359AVENUE SUPERMARTS LTD DAMRAVATI",
    debit: "100.00",
  });
  assert.equal(avenue.channel, "POS");
  assert.equal(avenue.merchant, "AVENUE SUPERMARTS LTD");
  assert.equal(avenue.category, "groceries");
  assert.equal(
    enrich({ ...base, description: "POS ATM PURCH SBIPOS006007901559Avenue Supermarts Ltd AMRAVATI", debit: "100.00" })
      .merchant,
    "Avenue Supermarts Ltd",
  );
  assert.equal(
    enrich({ ...base, description: "POS ATM PURCH OTHPOS501809728503DMART AVENUE SUPERMARTAMRAVATI", debit: "100.00" })
      .merchant,
    "DMART AVENUE SUPERMART",
  );
  assert.equal(
    enrich({
      ...base,
      description: "POS ATM PURCH OTHPOS505314976834M S SHRADDHA FAMILY SHAMRAVATI",
      debit: "100.00",
    }).merchant,
    "M S SHRADDHA FAMILY SH",
  );
  assert.equal(
    enrich({
      ...base,
      description: "CHQ TRFR FROM 0032474162205 OF Mr. VIJAY SHAMRAO KHER",
      debit: null,
      credit: "100.00",
    }).merchant,
    "Unknown",
  );
});

test("flags a refund narration", () => {
  const enriched = enrich({
    txnDate: "2025-03-03",
    valueDate: "2025-03-03",
    description: "UPI/CR/533770857986/Flipkart/YESB/flipkart.h/Refu",
    refNo: null,
    debit: null,
    credit: "1118.00",
    balance: "1000.00",
  });
  assert.equal(enriched.isRefund, true);
  assert.equal(enriched.category, "refund");
});

test("parses compact statement lines with no spaces", () => {
  const { lines, summary } = parseStatementText(`
01/01/202501/01/2025
WDL TFR
UPI/DR/1/Flipkart/HDFC/x/Pay
-1,002.00-3,44,404.59
03/01/202503/01/2025
DEP TFR
--56,000.004,00,404.59
18/08/202518/08/2025
CHQ
639251-50,300.001,28,310.92
Statement Summary
3,45,406.59CR18,31,530.7715,80,764.18
1,28,310.92CR
12
`);
  assert.equal(lines.length, 3);
  assert.equal(lines[0]?.debit, "1002.00");
  assert.equal(lines[1]?.credit, "56000.00");
  assert.equal(lines[1]?.balance, "400404.59");
  assert.equal(lines[2]?.refNo, "639251");
  assert.equal(lines[2]?.credit, "50300.00");
  assert.equal(summary?.countToken, "12");
  assert.equal(summary?.closingBalance, "128310.92");
  assertSummary(lines, summary);
});

test("reads transactions that follow an opening account summary", () => {
  const { lines, summary } = parseStatementText(`
Account Summary
Clear Balance
94,640.00CR
0.00
Statement of account
01/01/202501/01/2025
WDL TFR
UPI/DR/1/Flipkart/HDFC/x/Pay
-1,002.00-3,44,404.59
03/01/202503/01/2025
DEP TFR
--56,000.004,00,404.59
Statement Summary:01-01-2025 To 05-10-2026
Brought Forward
Dr CountCr CountTotal DebitsTotal Credits
Closing Balance
3,45,406.59CR18,31,530.7715,80,764.18
4,00,404.59CR
11
`);
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.debit, "1002.00");
  assert.equal(lines[1]?.credit, "56000.00");
  assert.equal(lines[1]?.balance, "400404.59");
  assert.equal(summary?.closingBalance, "400404.59");
  assert.equal(summary?.countToken, "11");
  assertSummary(lines, summary);
});

test("explains a locked PDF and an empty scan", () => {
  assert.equal(
    pdfFailureMessage(Object.assign(new Error("No password given"), { name: "PasswordException" })),
    "This PDF is password protected. Remove the password and upload it again.",
  );
  assert.equal(pdfFailureMessage(new Error("Invalid PDF structure")), null);
  assert.throws(
    () => assertPdfHasText("Page 1"),
    /This PDF has no readable text/,
  );
});

test("reads a labeled statement summary", () => {
  const { summary } = parseStatementText(`
01/01/2025 01/01/2025 WDL TFR
UPI/DR/1/Flipkart/HDFC/x/Pay
- 1,002.00 - 3,44,404.59
Statement Summary
Opening Balance 3,45,406.59 CR
Withdrawals 1,002.00
Deposits 0.00
Closing Balance 3,44,404.59 CR
No. of Debits 1
No. of Credits 0
`);
  assert.equal(summary?.closingBalance, "344404.59");
  assert.equal(summary?.debitCount, 1);
  assert.equal(summary?.creditCount, 0);
});

test("keeps transactions when the statement summary cannot be read", () => {
  const { lines, summary } = parseStatementText(`
01/01/2025 01/01/2025 WDL TFR
UPI/DR/1/Flipkart/HDFC/x/Pay
- 1,002.00 - 3,44,404.59
Statement Summary
Totals are printed as a graphic
`);
  assert.equal(lines.length, 1);
  assert.equal(lines[0]?.debit, "1002.00");
  assert.equal(summary, null);
});

test("reads single-date rows used by other banks", () => {
  const { lines } = parseStatementText(`
01/04/2025 UPI-SWIGGY  500.00  12,345.67
02/04/2025 NEFT SALARY 50,000.00  62,345.67
`);
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.txnDate, "2025-04-01");
  assert.equal(lines[0]?.debit, "500.00");
  assert.equal(lines[0]?.credit, null);
  assert.equal(lines[0]?.balance, "12345.67");
  assert.equal(lines[1]?.credit, "50000.00");
  assert.equal(lines[1]?.debit, null);
});

test("reads compact HDFC rows where date, ref, and amounts are glued", () => {
  const { lines, summary } = parseStatementText(`
DateNarrationChq./Ref.No.Value DtWithdrawal Amt.Deposit Amt.Closing Balance
01/04/25UPI-SWIGGY
PAY-SWIGGY@YBL
000041337768680801/04/25862.0027,609.92
-YESB0YBLUPI-413377686808-PAYMENT FROM P
HONE
Page No .: 1
Statement of account
From  :  01/04/2025To  :  31/03/2026
OD Limit:  0.00
01/04/25UPI-STORE-BHARATPE@YBL000005367430266901/04/25158.0027,451.92
04/04/25NEFT CR-ICICI-PAYROLL-TESTICICN2202504040104/04/25162,725.00190,176.92
STATEMENT SUMMARY  :-
Opening BalanceDr CountCr CountDebitsCreditsClosing Bal
28,471.92211162,883.00162,725.00190,176.92
`);
  assert.equal(lines.length, 3);
  assert.equal(lines[0]?.txnDate, "2025-04-01");
  assert.equal(lines[0]?.debit, "862.00");
  assert.equal(lines[0]?.balance, "27609.92");
  assert.equal(lines[1]?.debit, "158.00");
  assert.equal(lines[2]?.credit, "162725.00");
  assert.equal(lines[2]?.debit, null);
  assert.equal(summary?.closingBalance, "190176.92");
  assertSummary(lines, summary);
});

test("does not treat a three-digit year in a reference as a transaction date", () => {
  const { lines } = parseStatementText(`
01/04/25UPI-SWIGGY-PAY@YBL000041337768680801/04/25862.0027,609.92
05/03/6500000046589091305/08/254,024.00347.99
02/04/25UPI-STORE-PAY@YBL000005367430266901/04/25158.0027,451.92
`);
  assert.equal(lines.length, 2);
  assert.equal(lines[0]?.txnDate, "2025-04-01");
  assert.equal(lines[1]?.txnDate, "2025-04-02");
  assert.ok(lines.every((line) => line.txnDate.startsWith("2025-")));
});

test("reads an HDFC credit whose narration starts with digits after the year", () => {
  const { lines } = parseStatementText(`
04/04/25UPI-SWIGGY-PAY@YBL000041337768680801/04/25378.0024,591.92
04/04/2550200007296561-SALARY CREDIT000050404579879104/04/25162,725.00187,316.92
04/04/25UPI-STORE-PAY@YBL000046646896681404/04/25588.00186,728.92
`);
  assert.equal(lines.length, 3);
  assert.equal(lines[1]?.txnDate, "2025-04-04");
  assert.equal(lines[1]?.credit, "162725.00");
  assert.equal(lines[2]?.debit, "588.00");
  assert.equal(lines[2]?.balance, "186728.92");
});

test("keeps a negative closing balance on a glued HDFC row", () => {
  const { lines } = parseStatementText(`
31/07/25ACH C- IDFC FIRST BANK-11318721000000128086035431/07/25197.75347.99
05/08/25EMI 465890913 CHQ S4658909130041 0825465000000046589091305/08/254,024.00-3,676.01
05/08/25EMI 465890913 CHQ S4658909130041 0825465000000046589091305/08/254,024.00347.99
05/08/25NEFT CR-ICICI-PAYROLL-TESTICICN2202504040105/08/25119,403.00119,750.99
`);
  assert.equal(lines.length, 4);
  assert.equal(lines[1]?.debit, "4024.00");
  assert.equal(lines[1]?.balance, "-3676.01");
  assert.equal(lines[2]?.credit, "4024.00");
  assert.equal(lines[3]?.credit, "119403.00");
});

test("reads dashed dates, month names, and debit credit columns", () => {
  const { lines } = parseStatementText(`
01-Apr-2025 UPI/DR/1/Swiggy/HDFC/x/Pay 400.00 0.00 9,600.00
02-Apr-2025 UPI/CR/2/Refund/HDFC/x/Pay 0.00 400.00 10,000.00
03-04-2025 POS PURCHASE 250.00 DR 9,750.00
`);
  assert.equal(lines.length, 3);
  assert.equal(lines[0]?.txnDate, "2025-04-01");
  assert.equal(lines[0]?.debit, "400.00");
  assert.equal(lines[1]?.credit, "400.00");
  assert.equal(lines[2]?.txnDate, "2025-04-03");
  assert.equal(lines[2]?.debit, "250.00");
  assert.equal(lines[2]?.balance, "9750.00");
});

test("treats a card bill and a wallet top-up as expenses once the money left the account", () => {
  const line = {
    txnDate: "2025-01-05",
    valueDate: "2025-01-05",
    description: "",
    refNo: null,
    debit: "100.00",
    credit: null,
    balance: "1000.00",
  };
  const card = enrich({ ...line, description: "UPI/DR/1/HDFC CARD/HDFC/hdfc/Pay", debit: "5000.00" });
  const wallet = enrich({ ...line, description: "UPI/DR/2/PAYTM WALLET/HDFC/paytm/Pay", debit: "1000.00" });
  const fee = enrich({ ...line, description: "DEBIT ATMCard AMC", debit: "236.00" });
  assert.equal(card.source, "transfer:card");
  assert.equal(card.category, "transfer");
  assert.equal(isExpense(card), true);
  assert.equal(isOutflow(card), true);
  assert.equal(wallet.source, "transfer:wallet");
  assert.equal(isExpense(wallet), true);
  assert.equal(fee.category, "fees");
  assert.equal(fee.source, null);
});

test("parses a csv statement", () => {
  const lines = parseCsv(
    "txn_date,value_date,description,ref_no,debit,credit,balance\n2025-01-05,2025-01-05,UPI/DR/1/Swiggy/HDFC/x/Pay,,400.00,,1000.00\n",
  );
  assert.equal(lines.length, 1);
  assert.equal(enrich(lines[0] as NonNullable<(typeof lines)[0]>).category, "food");
});
