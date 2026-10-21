import { readQuery, writePool, writeQuery } from "../db.js";
import { occupiedSessionMessage } from "./bank.js";
import type { EnrichedLine, ImportResult, StatementLine, StatementSummary } from "../types.js";
import { enrich, rowHash } from "./enrich.js";
import { assertSummary } from "./parse-pdf.js";

export async function assertSameBank(incoming: string | null, lines: StatementLine[]): Promise<void> {
  const existing = await readQuery<{ count: string }>(`SELECT COUNT(*)::text AS count FROM transactions`);
  if (Number(existing[0]?.count ?? 0) === 0) return;
  const locked = await loadedBank();
  const sameFile = await overlapsLoaded(lines);
  if (!locked) {
    if (sameFile) {
      await rememberBank(incoming);
      return;
    }
    throw new Error(occupiedSessionMessage(null, incoming));
  }
  if (incoming && locked !== incoming) {
    if (sameFile) {
      await writeQuery(`UPDATE statement_lock SET bank = $1 WHERE id = 1`, [incoming]);
      return;
    }
    throw new Error(occupiedSessionMessage(locked, incoming));
  }
  if (!incoming && !sameFile) throw new Error(occupiedSessionMessage(locked, null));
}

export async function rememberBank(bank: string | null): Promise<void> {
  if (!bank) return;
  const locked = await loadedBank();
  if (locked) return;
  await writeQuery(`INSERT INTO statement_lock (id, bank) VALUES (1, $1) ON CONFLICT (id) DO NOTHING`, [bank]);
}

export async function loadedBank(): Promise<string | null> {
  const rows = await writeQuery<{ bank: string }>(`SELECT bank FROM statement_lock WHERE id = 1`);
  return rows[0]?.bank ?? null;
}

async function overlapsLoaded(lines: StatementLine[]): Promise<boolean> {
  if (lines.length === 0) return false;
  const hashes = lines.map((line) => rowHash(enrich(line)));
  const hashed = await readQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count FROM transactions WHERE row_hash = ANY($1::text[])`,
    [hashes],
  );
  if (Number(hashed[0]?.count ?? 0) > 0) return true;
  const dates = lines.map((line) => line.txnDate);
  const balances = lines.map((line) => line.balance);
  const debits = lines.map((line) => line.debit ?? "0");
  const credits = lines.map((line) => line.credit ?? "0");
  const amounts = await readQuery<{ count: string }>(
    `SELECT COUNT(*)::text AS count
     FROM transactions AS loaded
     JOIN unnest($1::date[], $2::numeric[], $3::numeric[], $4::numeric[]) AS incoming(txn_date, balance, debit, credit)
       ON loaded.txn_date = incoming.txn_date
      AND loaded.balance = incoming.balance
      AND COALESCE(loaded.debit, 0) = incoming.debit
      AND COALESCE(loaded.credit, 0) = incoming.credit`,
    [dates, balances, debits, credits],
  );
  return Number(amounts[0]?.count ?? 0) >= 3;
}

export async function clearStatementLock(): Promise<void> {
  await writeQuery(`DELETE FROM statement_lock`);
}

export async function insertLines(lines: StatementLine[], summary: StatementSummary | null): Promise<ImportResult> {
  assertSummary(lines, summary);
  if (lines.length === 0) {
    throw new Error("No transactions found in the document");
  }

  const enriched = lines.map((line) => enrich(line));
  const client = await writePool.connect();
  try {
    await client.query("BEGIN");
    let insertedCount = 0;
    for (const line of enriched) {
      const inserted = await client.query(
        `INSERT INTO transactions (
           txn_date, value_date, description, ref_no, debit, credit, balance,
           channel, merchant, category, is_refund, is_self_transfer, source, row_hash
         ) VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14)
         ON CONFLICT (row_hash) DO NOTHING`,
        [
          line.txnDate,
          line.valueDate,
          line.description,
          line.refNo,
          line.debit,
          line.credit,
          line.balance,
          line.channel,
          line.merchant,
          line.category,
          line.isRefund,
          line.isSelfTransfer,
          line.source,
          rowHash(line),
        ],
      );
      insertedCount += inserted.rowCount ?? 0;
    }
    await client.query("COMMIT");
    return { insertedCount, skippedCount: enriched.length - insertedCount };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

export async function refreshClassification(): Promise<void> {
  const rows = await writeQuery<StatementLine & { id: string }>(
    `SELECT id::text,
            to_char(txn_date, 'YYYY-MM-DD') AS "txnDate",
            to_char(value_date, 'YYYY-MM-DD') AS "valueDate",
            description,
            ref_no AS "refNo",
            debit::text,
            credit::text,
            balance::text
     FROM transactions`,
  );
  for (const row of rows) {
    const next = enrich(row);
    await writeQuery(
      `UPDATE transactions
       SET channel = $2, merchant = $3, category = $4, is_refund = $5, is_self_transfer = $6, source = $7
       WHERE id = $1`,
      [row.id, next.channel, next.merchant, next.category, next.isRefund, next.isSelfTransfer, next.source],
    );
  }
}

export function describeLine(line: EnrichedLine): string {
  return `${line.txnDate} ${line.merchant} ${line.category}`;
}
