import { Pool } from "pg";

const VIEW_SQL = `
CREATE OR REPLACE VIEW v_transactions AS
SELECT
  id,
  txn_date,
  value_date,
  description,
  ref_no,
  debit,
  credit,
  balance,
  channel,
  transactions.merchant,
  category,
  is_refund,
  is_self_transfer,
  source,
  CASE WHEN debit IS NOT NULL THEN 'debit' ELSE 'credit' END AS direction,
  COALESCE(debit, credit) AS amount,
  (debit IS NOT NULL AND is_refund = false AND is_self_transfer = false) AS is_outflow,
  (
    debit IS NOT NULL
    AND is_refund = false
    AND is_self_transfer = false
    AND category NOT IN ('self_transfer', 'investment', 'cash')
  ) AS is_expense,
  (
    credit IS NOT NULL
    AND is_refund = false
    AND is_self_transfer = false
    AND source IS DISTINCT FROM 'transfer:bank_credit'
  ) AS is_receipt,
  ml.label AS user_label,
  COALESCE(ml.business, false) AS label_business,
  (
    debit IS NOT NULL
    AND is_refund = false
    AND is_self_transfer = false
    AND (
      source = 'transfer:fibe'
      OR (source = 'transfer:bank_credit' AND description ~* '\\memi\\M')
    )
  ) AS is_emi,
  (
    credit IS NOT NULL
    AND is_refund = false
    AND is_self_transfer = false
    AND source = 'transfer:bank_credit'
  ) AS is_loan_credit
FROM transactions
LEFT JOIN merchant_labels ml ON ml.merchant = transactions.merchant`;

export async function ensureSchema(): Promise<void> {
  await dropMerchantPlaces();
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  try {
    await admin.query(`ALTER TABLE transactions ADD COLUMN IF NOT EXISTS source text`);
    await admin.query(
      `CREATE TABLE IF NOT EXISTS merchant_labels (
         merchant text PRIMARY KEY,
         label text NOT NULL,
         business boolean NOT NULL DEFAULT false
       )`,
    );
    await admin.query(
      `CREATE TABLE IF NOT EXISTS statement_lock (
         id int PRIMARY KEY DEFAULT 1 CHECK (id = 1),
         bank text NOT NULL
       )`,
    );
    await admin.query(VIEW_SQL);
    await admin.query(
      `COMMENT ON VIEW v_transactions IS 'Query this view. is_expense is money that left the account, including transfers and Loan/EMI. Self-transfers, ATM cash, and investments are not expenses. is_outflow is money that left. is_receipt excludes refunds, self-transfers, and loan credits. Earnings are only interest and tax_refund.'`,
    );
    await admin.query(
      `COMMENT ON COLUMN v_transactions.is_outflow IS 'Debit that is not a refund or a self-transfer. Includes EMI, person-to-person, investment, and ATM cash.'`,
    );
    await admin.query(
      `COMMENT ON COLUMN v_transactions.is_expense IS 'Debit that left the account. Includes transfers and Loan/EMI. Excludes self-transfers, ATM cash, and investments.'`,
    );
    await admin.query(
      `COMMENT ON COLUMN v_transactions.is_receipt IS 'Credit that is not a refund, a self-transfer, or a loan credit. Money that came in, not earnings and not borrowing.'`,
    );
    await admin.query(
      `COMMENT ON COLUMN v_transactions.is_emi IS 'EMI or loan repayment debit. It is an expense in category loan_emi. The statement does not split principal and interest.'`,
    );
    await admin.query(
      `COMMENT ON COLUMN v_transactions.is_loan_credit IS 'Loan or disbursement credit. Borrowing, not a receipt and not income.'`,
    );
    await admin.query(`GRANT SELECT ON transactions, v_transactions, merchant_labels TO chat_ro`);
    await admin.query(`GRANT SELECT, INSERT, UPDATE, DELETE ON transactions, merchant_labels, statement_lock TO chat_rw`);
  } finally {
    await admin.end();
  }
}

async function dropMerchantPlaces(): Promise<void> {
  const admin = new Pool({ connectionString: adminUrl(), max: 1 });
  try {
    await admin.query(`DROP TABLE IF EXISTS merchant_places`);
  } finally {
    await admin.end();
  }
}

function adminUrl(): string {
  if (process.env.DATABASE_URL_ADMIN) return process.env.DATABASE_URL_ADMIN;
  const migrate = process.env.DATABASE_URL_MIGRATE ?? "";
  return migrate.replace(/\/\/[^@]+@/, "//postgres:postgres@");
}
