import assert from "node:assert/strict";
import test from "node:test";
import { bankMismatchMessage, detectIssuerBank, headerText, loadedStatementMessage, occupiedSessionMessage } from "./bank.js";

test("does not treat a PhonePe Yes Bank UPI rail as the HDFC issuer", () => {
  const compact = `DateNarrationChq./Ref.No.Value DtWithdrawal Amt.Deposit Amt.Closing Balance
01/04/25UPI-SWIGGY
PAY-SWIGGY@YBL
000041337768680801/04/25862.0027,609.92
-YESB0YBLUPI-413377686808-PAYMENT FROM PHONE`;
  assert.equal(detectIssuerBank(compact), null);
  assert.doesNotMatch(headerText(compact), /YESB0YBLUPI/);

  const withSite = `www.hdfcbank.com
Statement of account
From : 01/04/2025 To : 31/03/2026
01/04/25UPI-SWIGGY
-YESB0YBLUPI-413377686808-PAYMENT FROM PHONE 862.00 27,609.92`;
  assert.equal(detectIssuerBank(withSite), "HDFC");
});

test("reads the issuer from letterhead, not from a UPI rail", () => {
  const hdfc = `HDFC Bank Limited
Account Statement
Customer name TEST
04/04/25UPI/DR/1/Swiggy/SBI/swiggy/Pay 400.00 9,600.00`;
  const sbi = `State Bank of India
Statement of account
Account Branch AMRAVATI
01-04-2025 UPI/DR/1/Flipkart/HDFC/x/Pay 400.00 0.00 9,600.00`;
  assert.equal(detectIssuerBank(hdfc), "HDFC");
  assert.equal(detectIssuerBank(sbi), "SBI");
  assert.equal(detectIssuerBank("01-04-2025 UPI/DR/1/Swiggy/HDFC/x/Pay 400.00 9,600.00"), null);
  assert.doesNotMatch(headerText(hdfc), /UPI/);
});

test("reads the issuer from the header IFSC, not from a later UPI line", () => {
  const hdfc = `Account Branch : MAHAL
RTGS/NEFT IFSC : HDFC0003646
04/04/25 UPI/DR/1/Swiggy/SBIN0001234/Pay 400.00 9,600.00`;
  const sbi = `Branch Code : 1234
IFSC : SBIN0001234
01-04-2025 UPI/DR/1/Flipkart/HDFC0003646/Pay 400.00 9,600.00`;
  assert.equal(detectIssuerBank(hdfc), "HDFC");
  assert.equal(detectIssuerBank(sbi), "SBI");
  assert.equal(detectIssuerBank("01-04-2025 UPI/DR/1/Swiggy/HDFC0003646/Pay 400.00"), null);
  const dateBeforeIfsc = `13/03/2019
RTGS/NEFT IFSC : HDFC0003646
04/04/25 UPI/DR/1/Swiggy/SBIN0001234/Pay 400.00 9,600.00`;
  assert.equal(detectIssuerBank(dateBeforeIfsc), "HDFC");
  const sbiColumns = `01/04/2025 to 31/03/2026
Account Number : 12345678901
IFS Code
SBIN0001234
01/04/2025 UPI/DR/1/Flipkart/HDFC0003646/Pay 400.00 9,600.00`;
  assert.equal(detectIssuerBank(sbiColumns), "SBI");
});

test("tells the user to reset when the loaded bank was not recorded", () => {
  assert.match(loadedStatementMessage(), /Clear all transactions/);
});

test("names the loaded bank in the mismatch message", () => {
  assert.equal(
    bankMismatchMessage("HDFC", "SBI"),
    "This session already has HDFC transactions. Clear all transactions before loading SBI.",
  );
  assert.equal(
    occupiedSessionMessage("HDFC", null),
    "This session already has HDFC transactions. Clear all transactions before loading another statement.",
  );
});
