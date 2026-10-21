import { readQuery } from "../db.js";
import { serializeQueryRow, type MaskedRow } from "./tool-summary.js";

type ToolRows = { sql: string | null; rows: MaskedRow[] };
type Measure = "expense" | "outflow" | "receipt";

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;
const EMI_SQL = `category = 'transfer' AND description ~* 'fibe|emi|loan|earlysalary'`;
const CHARGE_SQL = `category = 'fees' OR description ~* 'penal|bounce|sms|amc|min.*bal'`;
const BOUNCE_SQL = `description ~* 'bounce|return|insufficient|penal|dishonou?r'`;

export async function executeFixedTool(name: string, args: Record<string, unknown>): Promise<ToolRows> {
  switch (name) {
    case "loan_readiness":
      return loanReadiness();
    case "savings_summary":
      return savingsSummary(isoDate(args.from, "from"), isoDate(args.to, "to"));
    case "top_payees":
      return topPayees(isoDate(args.from, "from"), isoDate(args.to, "to"), clampLimit(args.limit), measureOf(args.measure));
    case "charges_and_penalties":
      return chargesAndPenalties(isoDate(args.from, "from"), isoDate(args.to, "to"));
    case "compare_periods":
      return comparePeriods(
        measureOf(args.measure),
        isoDate(args.fromA, "fromA"),
        isoDate(args.toA, "toA"),
        isoDate(args.fromB, "fromB"),
        isoDate(args.toB, "toB"),
      );
    case "recurring_payments":
      return recurringPayments();
    default:
      throw new Error(`Unknown tool ${name}`);
  }
}

async function loanReadiness(): Promise<ToolRows> {
  const sql = `
    WITH bounds AS (
      SELECT
        (date_trunc('month', MAX(txn_date)) - interval '5 months')::date AS window_start,
        MAX(txn_date)::date AS window_end
      FROM v_transactions
    ),
    months AS (
      SELECT generate_series(
        date_trunc('month', window_start),
        date_trunc('month', window_end),
        interval '1 month'
      )::date AS month
      FROM bounds
    ),
    monthly AS (
      SELECT
        date_trunc('month', t.txn_date)::date AS month,
        COALESCE(SUM(t.amount) FILTER (WHERE t.is_receipt), 0)::float8 AS receipts,
        COALESCE(SUM(t.amount) FILTER (WHERE t.is_expense), 0)::float8 AS expenses,
        COALESCE(SUM(t.amount) FILTER (WHERE ${EMI_SQL}), 0)::float8 AS emi
      FROM v_transactions t, bounds b
      WHERE t.txn_date >= b.window_start AND t.txn_date <= b.window_end
      GROUP BY 1
    ),
    month_end AS (
      SELECT DISTINCT ON (date_trunc('month', t.txn_date))
        date_trunc('month', t.txn_date)::date AS month,
        t.balance::float8 AS balance
      FROM v_transactions t, bounds b
      WHERE t.txn_date >= b.window_start AND t.txn_date <= b.window_end
      ORDER BY date_trunc('month', t.txn_date), t.txn_date DESC, t.id DESC
    )
    SELECT
      (SELECT COUNT(*)::int FROM months) AS months_covered,
      (SELECT COALESCE(AVG(receipts), 0)::float8 FROM monthly) AS avg_monthly_receipts,
      (SELECT COUNT(*)::int FROM monthly WHERE receipts > 0) AS months_with_receipts,
      (SELECT COALESCE(AVG(emi), 0)::float8 FROM monthly) AS avg_monthly_emi,
      (
        SELECT CASE
          WHEN COALESCE(AVG(receipts), 0) = 0 THEN NULL
          ELSE ROUND((100.0 * COALESCE(AVG(emi), 0) / AVG(receipts))::numeric, 2)::float8
        END
        FROM monthly
      ) AS emi_receipts_percent,
      (SELECT COALESCE(AVG(expenses), 0)::float8 FROM monthly) AS avg_monthly_expense,
      (SELECT COALESCE(AVG(balance), 0)::float8 FROM month_end) AS avg_month_end_balance,
      (
        SELECT COALESCE(MIN(t.balance), 0)::float8
        FROM v_transactions t, bounds b
        WHERE t.txn_date >= b.window_start AND t.txn_date <= b.window_end
      ) AS min_balance,
      (
        SELECT COUNT(*)::int
        FROM v_transactions t, bounds b
        WHERE t.txn_date >= b.window_start AND t.txn_date <= b.window_end
          AND (${BOUNCE_SQL})
      ) AS bounce_return_count
  `;
  return { sql, rows: await query(sql) };
}

async function savingsSummary(from: string, to: string): Promise<ToolRows> {
  const sql = `
    WITH monthly AS (
      SELECT
        to_char(date_trunc('month', txn_date), 'YYYY-MM') AS month,
        ROUND(COALESCE(SUM(amount) FILTER (WHERE is_receipt), 0), 2) AS receipts,
        ROUND(COALESCE(SUM(amount) FILTER (WHERE is_expense), 0), 2) AS expenses,
        ROUND(COALESCE(SUM(amount) FILTER (WHERE is_outflow), 0), 2) AS outflow
      FROM v_transactions
      WHERE txn_date >= $1::date AND txn_date <= $2::date
      GROUP BY 1
    ),
    with_net AS (
      SELECT
        month,
        receipts,
        expenses,
        outflow,
        ROUND(receipts - outflow, 2) AS net,
        CASE WHEN receipts = 0 THEN NULL
          ELSE ROUND(100.0 * (receipts - outflow) / receipts, 2)
        END AS savings_rate_pct
      FROM monthly
    )
    SELECT month, receipts, expenses, outflow, net, savings_rate_pct FROM with_net
    UNION ALL
    SELECT
      'total' AS month,
      ROUND(COALESCE(SUM(receipts), 0), 2),
      ROUND(COALESCE(SUM(expenses), 0), 2),
      ROUND(COALESCE(SUM(outflow), 0), 2),
      ROUND(COALESCE(SUM(net), 0), 2),
      CASE WHEN COALESCE(SUM(receipts), 0) = 0 THEN NULL
        ELSE ROUND(100.0 * SUM(net) / SUM(receipts), 2)
      END
    FROM with_net
    ORDER BY month
  `;
  return { sql, rows: await query(sql, [from, to]) };
}

async function topPayees(from: string, to: string, limit: number, measure: Measure): Promise<ToolRows> {
  const sql = `
    SELECT lower(merchant) AS merchant, COUNT(*)::int AS count, COALESCE(SUM(amount), 0)::float8 AS total
    FROM v_transactions
    WHERE txn_date >= $1::date AND txn_date <= $2::date
      AND (
        ($3 = 'expense' AND is_expense)
        OR ($3 = 'outflow' AND is_outflow)
        OR ($3 = 'receipt' AND is_receipt)
      )
    GROUP BY lower(merchant)
    ORDER BY total DESC, merchant ASC
    LIMIT $4
  `;
  return { sql, rows: await query(sql, [from, to, measure, limit]) };
}

async function chargesAndPenalties(from: string, to: string): Promise<ToolRows> {
  const sql = `
    WITH monthly AS (
      SELECT
        to_char(date_trunc('month', txn_date), 'YYYY-MM') AS month,
        COUNT(*)::int AS count,
        COALESCE(SUM(amount), 0)::float8 AS total
      FROM v_transactions
      WHERE txn_date >= $1::date AND txn_date <= $2::date
        AND (${CHARGE_SQL})
      GROUP BY 1
    )
    SELECT month, count, total FROM monthly
    UNION ALL
    SELECT 'total', COALESCE(SUM(count), 0)::int, COALESCE(SUM(total), 0)::float8 FROM monthly
    ORDER BY month
  `;
  return { sql, rows: await query(sql, [from, to]) };
}

async function comparePeriods(
  measure: Measure,
  fromA: string,
  toA: string,
  fromB: string,
  toB: string,
): Promise<ToolRows> {
  const sql = `
    WITH a AS (
      SELECT COALESCE(SUM(amount), 0)::float8 AS total
      FROM v_transactions
      WHERE txn_date >= $2::date AND txn_date <= $3::date
        AND (
          ($1 = 'expense' AND is_expense)
          OR ($1 = 'outflow' AND is_outflow)
          OR ($1 = 'receipt' AND is_receipt)
        )
    ),
    b AS (
      SELECT COALESCE(SUM(amount), 0)::float8 AS total
      FROM v_transactions
      WHERE txn_date >= $4::date AND txn_date <= $5::date
        AND (
          ($1 = 'expense' AND is_expense)
          OR ($1 = 'outflow' AND is_outflow)
          OR ($1 = 'receipt' AND is_receipt)
        )
    )
    SELECT
      a.total AS total_a,
      b.total AS total_b,
      (b.total - a.total)::float8 AS difference,
      CASE WHEN a.total = 0 THEN NULL
        ELSE ROUND((100.0 * (b.total - a.total) / a.total)::numeric, 2)::float8
      END AS percent_change
    FROM a, b
  `;
  return { sql, rows: await query(sql, [measure, fromA, toA, fromB, toB]) };
}

async function recurringPayments(): Promise<ToolRows> {
  const sql = `
    WITH monthly AS (
      SELECT
        lower(merchant) AS merchant,
        date_trunc('month', txn_date) AS month,
        SUM(amount)::float8 AS total
      FROM v_transactions
      WHERE is_outflow
      GROUP BY 1, 2
    ),
    stats AS (
      SELECT
        merchant,
        COUNT(*)::int AS months_seen,
        AVG(total)::float8 AS typical_amount,
        COALESCE(STDDEV_POP(total), 0)::float8 AS stddev
      FROM monthly
      GROUP BY merchant
      HAVING COUNT(*) >= 3
    )
    SELECT merchant, months_seen, typical_amount, stddev
    FROM stats
    WHERE typical_amount > 0 AND stddev < 0.05 * typical_amount
    ORDER BY typical_amount DESC, merchant ASC
  `;
  return { sql, rows: await query(sql) };
}

async function query(sql: string, values: unknown[] = []): Promise<MaskedRow[]> {
  const rows = await readQuery(sql, values);
  return rows.map(serializeQueryRow);
}

function isoDate(value: unknown, field: string): string {
  if (typeof value !== "string" || !ISO_DATE.test(value)) {
    throw new Error(`${field} must be an ISO date YYYY-MM-DD`);
  }
  const parsed = new Date(`${value}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== value) {
    throw new Error(`${field} must be a real calendar date`);
  }
  return value;
}

function clampLimit(value: unknown): number {
  const n = typeof value === "number" ? value : Number(value ?? 5);
  if (!Number.isFinite(n)) return 5;
  return Math.min(20, Math.max(1, Math.trunc(n)));
}

function measureOf(value: unknown): Measure {
  if (value === "expense" || value === "outflow" || value === "receipt") return value;
  throw new Error("measure must be expense, outflow, or receipt");
}
