import { BadRequestException, Body, Controller, Get, Post, Query, UploadedFile, UseInterceptors } from "@nestjs/common";
import { FileInterceptor } from "@nestjs/platform-express";
import { readQuery, writeQuery } from "../db.js";
import { assertBalanceChain } from "../ingest/balance-chain.js";
import { parseCsv } from "../ingest/parse-csv.js";
import { assertPdfHasText, parseStatementText, pdfFailureMessage, UNSUPPORTED_LAYOUT } from "../ingest/parse-pdf.js";
import { detectIssuerBank } from "../ingest/bank.js";
import { assertSameBank, clearStatementLock, insertLines, loadedBank, rememberBank } from "../ingest/store.js";
import type { ImportResult } from "../types.js";

interface ResetBody {
  confirm?: string;
}

interface CategoryTotal {
  category: string;
  total: string;
}

interface UploadedPdf {
  originalname: string;
  mimetype: string;
  size: number;
  buffer: Buffer;
}

@Controller("api")
export class StatementsController {
  @Post("statements/upload")
  @UseInterceptors(FileInterceptor("file", { limits: { fileSize: 15 * 1024 * 1024 } }))
  async upload(@UploadedFile() file?: UploadedPdf): Promise<ImportResult> {
    if (!file) throw new BadRequestException("Choose a PDF or CSV file");
    const name = file.originalname.toLowerCase();
    try {
      if (name.endsWith(".csv") || file.mimetype === "text/csv") {
        const csv = file.buffer.toString("utf8");
        const lines = parseCsv(csv);
        assertBalanceChain(lines);
        const bank = detectIssuerBank(csv);
        await assertSameBank(bank, lines);
        const result = await insertLines(lines, null);
        await rememberBank(bank);
        return result;
      }
      if (name.endsWith(".pdf") || file.mimetype === "application/pdf") {
        const parsed = await parsePdf(file.buffer);
        assertBalanceChain(parsed.lines);
        await assertSameBank(parsed.bank, parsed.lines);
        const result = await insertLines(parsed.lines, parsed.summary);
        await rememberBank(parsed.bank);
        return result;
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : "Could not import the file";
      throw new BadRequestException(message);
    }
    throw new BadRequestException("Upload a PDF or CSV statement");
  }

  @Post("statements/reset")
  async reset(@Body() body: ResetBody): Promise<{ ok: true }> {
    if (body.confirm !== "RESET") {
      throw new BadRequestException("Send confirm RESET to clear transactions and chat history");
    }
    await writeQuery(`DELETE FROM chat_messages`);
    await writeQuery(`DELETE FROM chat_sessions`);
    await writeQuery(`DELETE FROM transactions`);
    await clearStatementLock();
    return { ok: true };
  }

  @Get("summary")
  async summary(@Query("from") from?: string, @Query("to") to?: string): Promise<SummaryResponse> {
    const coverage = await coverageSpan();
    const range = await resolveRange(from, to);
    if (!range || !coverage) {
      return emptySummary();
    }
    const rows = await readQuery<SummaryRow>(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE is_expense), 0)::text AS expenses,
         COALESCE(SUM(amount) FILTER (WHERE is_outflow), 0)::text AS outflow,
         COALESCE(SUM(amount) FILTER (WHERE is_receipt), 0)::text AS receipts,
         COUNT(*)::text AS txns,
         COUNT(*) FILTER (WHERE is_expense AND (category = 'other' OR merchant = 'Unknown'))::text AS uncategorised,
         COUNT(*) FILTER (WHERE is_expense)::text AS expense_rows
       FROM v_transactions
       WHERE txn_date BETWEEN $1::date AND $2::date`,
      [range.from, range.to],
    );
    const row = rows[0];
    const expenseRows = Number(row?.expense_rows ?? 0);
    const uncategorised = Number(row?.uncategorised ?? 0);
    return {
      from: range.from,
      to: range.to,
      coverageFrom: coverage.from,
      coverageTo: coverage.to,
      coverageCount: coverage.count,
      loadedBank: await loadedBank(),
      expenses: row?.expenses ?? "0",
      outflow: row?.outflow ?? "0",
      receipts: row?.receipts ?? "0",
      txns: row?.txns ?? "0",
      uncategorisedPct: expenseRows === 0 ? 0 : Math.round((uncategorised / expenseRows) * 1000) / 10,
    };
  }

  @Get("transactions")
  async transactions(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("category") category?: string,
    @Query("source") source?: string,
    @Query("flow") flow?: string,
  ): Promise<{ rows: TxnRow[] }> {
    const range = await resolveRange(from, to);
    if (!range) return { rows: [] };
    const rows = await readQuery<TxnRow>(
      `SELECT to_char(txn_date, 'YYYY-MM-DD') AS txn_date,
              merchant,
              user_label,
              category,
              description,
              amount::text AS amount,
              direction,
              source
       FROM v_transactions
       WHERE txn_date BETWEEN $1::date AND $2::date
         AND ($3::text IS NULL OR category = $3)
         AND ($4::text IS NULL OR source = $4 OR ($4 NOT LIKE '%:%' AND merchant = $4))
         AND ($5::text IS NULL OR direction = $5)
       ORDER BY txn_date DESC, id DESC`,
      [range.from, range.to, category?.trim() || null, source?.trim() || null, flow === "debit" || flow === "credit" ? flow : null],
    );
    return { rows };
  }

  @Post("labels")
  async saveLabel(@Body() body: LabelBody): Promise<{ ok: true }> {
    const merchant = body.merchant?.trim() ?? "";
    const label = body.label?.trim() ?? "";
    if (!merchant || !label || merchant.length > 80 || label.length > 80) {
      throw new BadRequestException("Enter a payee and a short label");
    }
    await writeQuery(
      `INSERT INTO merchant_labels (merchant, label, business)
       VALUES ($1, $2, $3)
       ON CONFLICT (merchant) DO UPDATE SET label = EXCLUDED.label, business = EXCLUDED.business`,
      [merchant, label, body.business === true],
    );
    return { ok: true };
  }

  @Get("spending/by-category")
  async byCategory(
    @Query("from") from?: string,
    @Query("to") to?: string,
    @Query("measure") measure?: string,
  ): Promise<{ from: string; to: string; rows: CategoryTotal[] }> {
    const range = await resolveRange(from, to);
    if (!range) return { from: "", to: "", rows: [] };
    const column = measure === "outflow" ? "is_outflow" : "is_expense";
    const rows = await readQuery<CategoryTotal>(
      `SELECT category, SUM(amount)::text AS total
       FROM v_transactions
       WHERE ${column}
         AND txn_date BETWEEN $1::date AND $2::date
       GROUP BY category
       ORDER BY SUM(amount) DESC`,
      [range.from, range.to],
    );
    return { from: range.from, to: range.to, rows };
  }

  @Get("spending/breakdown")
  async breakdown(@Query("from") from?: string, @Query("to") to?: string): Promise<BreakdownResponse> {
    const range = await resolveRange(from, to);
    if (!range) return { from: "", to: "", grocery: [], food: [], investment: [], transferOut: [], transferIn: [], cashflow: [] };
    const [grocery, food, investment, transferOut, transferIn, cashflow] = await Promise.all([
      sourceTotals(range, "grocery:%", "debit"),
      sourceTotals(range, "food:%", "debit"),
      investmentTotals(range),
      readQuery<SourceTotal>(
        `SELECT to_char(date_trunc('month', txn_date), 'YYYY-MM') AS period,
                source,
                SUM(amount)::text AS total
         FROM v_transactions
         WHERE txn_date BETWEEN $1::date AND $2::date
           AND is_refund = false
           AND direction = 'debit'
           AND source LIKE 'transfer:%'
         GROUP BY 1, 2
         ORDER BY 1, 2`,
        [range.from, range.to],
      ),
      readQuery<SourceTotal>(
        `SELECT to_char(date_trunc('month', txn_date), 'YYYY-MM') AS period,
                source,
                SUM(amount)::text AS total
         FROM v_transactions
         WHERE txn_date BETWEEN $1::date AND $2::date
           AND is_refund = false
           AND is_self_transfer = false
           AND direction = 'credit'
           AND source LIKE 'transfer:%'
         GROUP BY 1, 2
         ORDER BY 1, 2`,
        [range.from, range.to],
      ),
      readQuery<CashflowTotal>(
        `SELECT to_char(date_trunc('month', txn_date), 'YYYY-MM') AS period,
                COALESCE(SUM(credit), 0)::text AS credit,
                COALESCE(SUM(debit), 0)::text AS debit,
                (ARRAY_AGG(balance ORDER BY txn_date DESC, id DESC))[1]::text AS closing
         FROM v_transactions
         WHERE txn_date BETWEEN $1::date AND $2::date
         GROUP BY 1
         ORDER BY 1`,
        [range.from, range.to],
      ),
    ]);
    return { from: range.from, to: range.to, grocery, food, investment, transferOut, transferIn, cashflow };
  }
}

interface SourceTotal {
  period: string;
  source: string;
  total: string;
}

interface BreakdownResponse {
  from: string;
  to: string;
  grocery: SourceTotal[];
  food: SourceTotal[];
  investment: SourceTotal[];
  transferOut: SourceTotal[];
  transferIn: SourceTotal[];
  cashflow: CashflowTotal[];
}

interface CashflowTotal {
  period: string;
  credit: string;
  debit: string;
  closing: string;
}

interface SummaryRow {
  expenses: string;
  outflow: string;
  receipts: string;
  txns: string;
  uncategorised: string;
  expense_rows: string;
}

interface SummaryResponse {
  from: string;
  to: string;
  coverageFrom: string;
  coverageTo: string;
  coverageCount: number;
  loadedBank: string | null;
  expenses: string;
  outflow: string;
  receipts: string;
  txns: string;
  uncategorisedPct: number;
}

interface TxnRow {
  txn_date: string;
  merchant: string;
  user_label: string | null;
  category: string;
  description: string;
  amount: string;
  direction: string;
  source: string | null;
}

interface LabelBody {
  merchant?: string;
  label?: string;
  business?: boolean;
}

async function investmentTotals(range: { from: string; to: string }): Promise<SourceTotal[]> {
  return readQuery<SourceTotal>(
    `SELECT to_char(date_trunc('month', txn_date), 'YYYY-MM') AS period,
            merchant AS source,
            SUM(amount)::text AS total
     FROM v_transactions
     WHERE txn_date BETWEEN $1::date AND $2::date
       AND is_refund = false
       AND direction = 'debit'
       AND category = 'investment'
     GROUP BY 1, 2
     ORDER BY 1, SUM(amount) DESC`,
    [range.from, range.to],
  );
}

async function sourceTotals(range: { from: string; to: string }, sourceLike: string, direction: "debit"): Promise<SourceTotal[]> {
  return readQuery<SourceTotal>(
    `SELECT to_char(date_trunc('month', txn_date), 'YYYY-MM') AS period,
            source,
            SUM(amount)::text AS total
     FROM v_transactions
     WHERE txn_date BETWEEN $1::date AND $2::date
       AND is_refund = false
       AND is_self_transfer = false
       AND direction = $3
       AND source LIKE $4
     GROUP BY 1, 2
     ORDER BY 1, 2`,
    [range.from, range.to, direction, sourceLike],
  );
}

async function coverageSpan(): Promise<{ from: string; to: string; count: number } | null> {
  const rows = await readQuery<{ first: string | null; last: string | null; count: string }>(
    `SELECT to_char(MIN(txn_date), 'YYYY-MM-DD') AS first,
            to_char(MAX(txn_date), 'YYYY-MM-DD') AS last,
            COUNT(*)::text AS count
     FROM transactions`,
  );
  const row = rows[0];
  if (!row?.first || !row.last) return null;
  return { from: row.first, to: row.last, count: Number(row.count) };
}

function emptySummary(): SummaryResponse {
  return {
    from: "",
    to: "",
    coverageFrom: "",
    coverageTo: "",
    coverageCount: 0,
    loadedBank: null,
    expenses: "0",
    outflow: "0",
    receipts: "0",
    txns: "0",
    uncategorisedPct: 0,
  };
}

async function resolveRange(from?: string, to?: string): Promise<{ from: string; to: string } | null> {
  const latest = await readQuery<{ latest: string | null }>(
    `SELECT to_char(MAX(txn_date), 'YYYY-MM-DD') AS latest FROM transactions`,
  );
  const end = validDate(to) ?? latest[0]?.latest;
  if (!end) return null;
  const start = validDate(from) ?? shiftMonths(end, -2);
  return { from: start, to: end };
}

async function parsePdf(buffer: Buffer): Promise<ReturnType<typeof parseStatementText> & { bank: string | null }> {
  const { createRequire } = await import("node:module");
  const require = createRequire(__filename);
  const pdfParse = require("pdf-parse/lib/pdf-parse.js") as (data: Buffer) => Promise<{ text: string }>;
  let text = "";
  try {
    const parsed = await pdfParse(buffer);
    text = parsed.text ?? "";
  } catch (error) {
    throw new Error(pdfFailureMessage(error) ?? (error instanceof Error ? error.message : "Could not read the PDF"));
  }
  assertPdfHasText(text);
  const statement = parseStatementText(text);
  if (statement.lines.length === 0) throw new Error(UNSUPPORTED_LAYOUT);
  return { ...statement, bank: detectIssuerBank(text) };
}

function validDate(value: string | undefined): string | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  return value;
}

function shiftMonths(isoDate: string, months: number): string {
  const [yearText, monthText] = isoDate.split("-");
  const date = new Date(Date.UTC(Number(yearText), Number(monthText) - 1 + months, 1));
  const year = date.getUTCFullYear();
  const month = String(date.getUTCMonth() + 1).padStart(2, "0");
  return `${year}-${month}-01`;
}
