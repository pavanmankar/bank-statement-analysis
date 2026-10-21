import { newPgPool } from "../db.js";

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

const BASE_TABLES_SQL = `
CREATE TABLE IF NOT EXISTS transactions (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  txn_date date NOT NULL,
  value_date date NOT NULL,
  description text NOT NULL,
  ref_no text,
  debit numeric(14, 2),
  credit numeric(14, 2),
  balance numeric(14, 2) NOT NULL,
  channel text NOT NULL,
  merchant text NOT NULL,
  category text NOT NULL,
  is_refund boolean NOT NULL DEFAULT false,
  is_self_transfer boolean NOT NULL DEFAULT false,
  source text,
  row_hash text NOT NULL UNIQUE,
  CONSTRAINT transactions_one_amount CHECK (
    (debit IS NOT NULL AND credit IS NULL)
    OR (debit IS NULL AND credit IS NOT NULL)
  )
);

CREATE INDEX IF NOT EXISTS transactions_txn_date_idx ON transactions (txn_date);
CREATE INDEX IF NOT EXISTS transactions_category_idx ON transactions (category);
CREATE INDEX IF NOT EXISTS transactions_merchant_idx ON transactions (merchant);

CREATE TABLE IF NOT EXISTS chat_sessions (
  id uuid PRIMARY KEY,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS chat_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  session_id uuid NOT NULL REFERENCES chat_sessions (id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('user', 'assistant')),
  content text NOT NULL,
  sql_text text,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS chat_messages_session_idx ON chat_messages (session_id, created_at);
`;

export async function ensureSchema(): Promise<void> {
  await dropMerchantPlaces();
  const admin = newPgPool(adminUrl(), 1);
  try {
    await admin.query(BASE_TABLES_SQL);
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
    await grantIfRole(
      admin,
      "chat_ro",
      `GRANT SELECT ON transactions, v_transactions, merchant_labels TO chat_ro`,
    );
    await grantIfRole(
      admin,
      "chat_rw",
      `GRANT SELECT, INSERT, UPDATE, DELETE ON transactions, chat_sessions, chat_messages, merchant_labels, statement_lock TO chat_rw`,
    );
    await grantIfRole(admin, "chat_rw", `GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO chat_rw`);
  } finally {
    await admin.end();
  }
}

async function grantIfRole(admin: ReturnType<typeof newPgPool>, role: string, sql: string): Promise<void> {
  const found = await admin.query(`SELECT 1 FROM pg_roles WHERE rolname = $1`, [role]);
  if (!found.rowCount) return;
  await admin.query(sql);
}

async function dropMerchantPlaces(): Promise<void> {
  const admin = newPgPool(adminUrl(), 1);
  try {
    await admin.query(`DROP TABLE IF EXISTS merchant_places`);
  } finally {
    await admin.end();
  }
}

function adminUrl(): string {
  if (process.env.DATABASE_URL_ADMIN) return process.env.DATABASE_URL_ADMIN;
  const migrate = process.env.DATABASE_URL_MIGRATE ?? "";
  if (/\/\/chat_rw:/i.test(migrate)) return migrate.replace(/\/\/[^@]+@/, "//postgres:postgres@");
  return migrate;
}
