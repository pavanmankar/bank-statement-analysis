import { useEffect, useRef, useState, type ChangeEvent, type JSX } from "react";
import { Bar, BarChart, CartesianGrid, Cell, LabelList, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { emptyAssistant, fetchBreakdown, fetchSpending, fetchSummary, fetchTransactions, resetData, streamChat, uploadStatement } from "./api";
import { ChatChart } from "./ChatChart";
import { DateRangePicker } from "./DateRangePicker";
import { ChartTip, DetailCharts } from "./DetailCharts";
import { categoryLabel, columnTitle, formatCoverage, formatDmy, inr, inrCompactText } from "./format";
import { presetRange } from "./ranges";
import type { BreakdownResponse, CategoryPoint, ChatMessage, SummaryResponse, TxnRow } from "./types";

const CHIPS = [
  "What are my top 5 merchants this FY?",
  "How much interest did I earn this FY?",
  "Were there any bank charges or penalties?",
  "Why was the last full month higher than the one before?",
];

export function App(): JSX.Element {
  const [sessionId, setSessionId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState("");
  const [status, setStatus] = useState("");
  const [busy, setBusy] = useState(false);
  const [from, setFrom] = useState("");
  const [to, setTo] = useState("");
  const [preset, setPreset] = useState("3m");
  const [points, setPoints] = useState<CategoryPoint[]>([]);
  const [summary, setSummary] = useState<SummaryResponse | null>(null);
  const [breakdown, setBreakdown] = useState<BreakdownResponse | null>(null);
  const [txns, setTxns] = useState<TxnRow[]>([]);
  const [pickedCategory, setPickedCategory] = useState("");
  const [pickedSource, setPickedSource] = useState("");
  const [pickedFlow, setPickedFlow] = useState<"" | "debit" | "credit">("");
  const [txnListKey, setTxnListKey] = useState(0);
  const [notice, setNotice] = useState("");
  const [confirmReset, setConfirmReset] = useState(false);
  const [openSql, setOpenSql] = useState<Record<string, boolean>>({});
  const fileInput = useRef<HTMLInputElement>(null);
  const chartBox = useRef<HTMLDivElement>(null);
  const [chartWidth, setChartWidth] = useState(0);
  const chatFits = useChatFits();
  const [chatOpen, setChatOpen] = useState(false);

  useEffect(() => {
    const node = chartBox.current;
    if (!node) return;
    const measure = (): void => setChartWidth(node.clientWidth);
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(node);
    return () => observer.disconnect();
  }, [points.length]);

  async function loadChart(start = from, end = to, txnFilter?: TxnFilter): Promise<void> {
    const category = txnFilter?.category ?? pickedCategory;
    const source = txnFilter?.source ?? pickedSource;
    const flow = txnFilter?.flow ?? pickedFlow;
    const [payload, detail, totals] = await Promise.all([
      fetchSpending(start, end),
      fetchBreakdown(start, end),
      fetchSummary(start, end),
    ]);
    setFrom(payload.from);
    setTo(payload.to);
    setPoints(payload.rows.map((row) => ({ category: row.category, total: Number(row.total) })));
    setBreakdown(detail);
    setSummary(totals);
    const rows = await fetchTransactions(payload.from, payload.to, category, source, flow);
    setTxns(rows);
  }

  function clearTxnFilters(): void {
    setPickedCategory("");
    setPickedSource("");
    setPickedFlow("");
    setTxnListKey((key) => key + 1);
  }

  useEffect(() => {
    loadChart().catch((error: unknown) => {
      setNotice(error instanceof Error ? error.message : "Chart unavailable");
    });
  }, []);

  useEffect(() => {
    if (chatFits) setChatOpen(false);
  }, [chatFits]);

  useEffect(() => {
    if (!chatOpen) return;
    const onKey = (event: KeyboardEvent): void => {
      if (event.key === "Escape") setChatOpen(false);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [chatOpen]);

  async function pickCategory(category: string): Promise<void> {
    setPickedCategory(category);
    setPickedSource("");
    setPickedFlow("");
    setTxns(await fetchTransactions(from, to, category, ""));
  }

  async function pickSource(source: string): Promise<void> {
    setPickedCategory("");
    setPickedSource(source);
    setPickedFlow("");
    setTxns(await fetchTransactions(from, to, "", source));
  }

  async function onPreset(id: string): Promise<void> {
    const coverageFrom = summary?.coverageFrom || from;
    const coverageTo = summary?.coverageTo || to;
    const next = presetRange(id, coverageFrom, coverageTo);
    setPreset(id);
    clearTxnFilters();
    await loadChart(next.from, next.to, OPEN_TXNS);
  }

  async function ask(message: string): Promise<void> {
    if (!message || busy) return;
    const userMessage: ChatMessage = {
      id: crypto.randomUUID(),
      role: "user",
      content: message,
      sql: null,
      rows: [],
      chart: null,
      pending: false,
      error: null,
    };
    const assistant = emptyAssistant();
    setMessages((current) => [...current, userMessage, assistant]);
    setDraft("");
    setBusy(true);
    setStatus("Reading your question");
    try {
      await streamChat(sessionId, message, {
        onSession: setSessionId,
        onStatus: setStatus,
        onSql: (sql) => updateAssistant(assistant.id, (item) => ({ ...item, sql })),
        onRows: (rows) => updateAssistant(assistant.id, (item) => ({ ...item, rows })),
        onChart: (chart) => updateAssistant(assistant.id, (item) => ({ ...item, chart })),
        onToken: (text) => updateAssistant(assistant.id, (item) => ({ ...item, content: item.content + text })),
        onError: (error) => updateAssistant(assistant.id, (item) => ({ ...item, error, pending: false })),
      });
      updateAssistant(assistant.id, (item) => ({ ...item, pending: false }));
      setStatus("");
    } catch (error) {
      const text = error instanceof Error ? error.message : "Chat failed";
      updateAssistant(assistant.id, (item) => ({ ...item, error: text, pending: false }));
      setStatus(text);
    } finally {
      setBusy(false);
    }
  }

  function updateAssistant(id: string, change: (message: ChatMessage) => ChatMessage): void {
    setMessages((current) => current.map((item) => (item.id === id ? change(item) : item)));
  }

  function onFilePicked(event: ChangeEvent<HTMLInputElement>): void {
    const file = event.target.files?.[0];
    event.target.value = "";
    void onUpload(file);
  }

  async function onUpload(file: File | undefined): Promise<void> {
    if (!file) return;
    setBusy(true);
    setNotice(`Reading ${file.name}…`);
    try {
      const result = await uploadStatement(file);
      if (result.insertedCount === 0 && result.skippedCount > 0) {
        setNotice(`Already loaded. ${result.skippedCount} transactions were already in the database.`);
      } else if (result.skippedCount > 0) {
        setNotice(`Added ${result.insertedCount} transactions. Skipped ${result.skippedCount} duplicates.`);
      } else {
        setNotice(`Added ${result.insertedCount} transactions.`);
      }
      await loadChart("", "");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Upload failed");
    } finally {
      setBusy(false);
    }
  }

  async function onReset(): Promise<void> {
    setBusy(true);
    try {
      await resetData();
      setMessages([]);
      setSessionId(null);
      setPoints([]);
      setBreakdown(null);
      setFrom("");
      setTo("");
      setConfirmReset(false);
      if (fileInput.current) fileInput.current.value = "";
      setNotice("Transactions and chat history were cleared. Choose the statement again to load it.");
    } catch (error) {
      setNotice(error instanceof Error ? error.message : "Reset failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="app">
      <header className="topbar">
        <div className="brand">
          <h1>Statements</h1>
          <p>
            {summary?.coverageFrom
              ? `${summary.loadedBank ? `${summary.loadedBank} statement` : "Statement"}: ${formatCoverage(summary.coverageFrom)} to ${formatCoverage(summary.coverageTo)} · ${summary.coverageCount} transactions · Balance checked on each upload`
              : "Upload a statement to see coverage"}
          </p>
        </div>
        <div className="actions">
          <input
            ref={fileInput}
            className="file-input"
            type="file"
            accept=".pdf,.csv,application/pdf,text/csv"
            onChange={onFilePicked}
            disabled={busy}
            aria-label="Upload a statement"
          />
          <button type="button" onClick={() => fileInput.current?.click()} disabled={busy}>
            Upload
          </button>
          {confirmReset ? (
            <div className="confirm">
              <span>Clear all transactions and chat?</span>
              <button type="button" className="danger" onClick={() => void onReset()} disabled={busy}>
                Clear
              </button>
              <button type="button" className="ghost" onClick={() => setConfirmReset(false)} disabled={busy}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="ghost" onClick={() => setConfirmReset(true)} disabled={busy}>
              Reset
            </button>
          )}
        </div>
      </header>
      {notice ? <p className="banner">{notice}</p> : null}
      <div className={`body ${chatFits ? "body-docked" : "body-compact"}`}>
        <section className="charts" aria-label="Spending charts">
          {summary ? (
            <div className="kpis">
              <Kpi label="Expenses" value={inr.format(Number(summary.expenses))} tone="spend" />
              <Kpi label="Money in" value={inr.format(Number(summary.receipts))} tone="in" />
              <Kpi
                label="Net"
                value={inr.format(Number(summary.receipts) - Number(summary.expenses))}
                tone={Number(summary.receipts) - Number(summary.expenses) >= 0 ? "net-up" : "net-down"}
              />
              <Kpi
                label="Uncategorised"
                value={`${summary.uncategorisedPct}%`}
                tone={summary.uncategorisedPct > 0 ? "warn" : "ok"}
              />
            </div>
          ) : null}
          <div className="split-row">
            <article className="card">
              <div className="card-head">
                <h2>Spending by category</h2>
              </div>
              <DateRangePicker
                from={from}
                to={to}
                activePreset={preset}
                onChange={(nextFrom, nextTo) => {
                  setPreset("");
                  clearTxnFilters();
                  void loadChart(nextFrom, nextTo, OPEN_TXNS);
                }}
                onPreset={(id) => {
                  void onPreset(id);
                }}
              />
              {points.length === 0 ? (
                <p className="muted">No spending in this range.</p>
              ) : (
                <div ref={chartBox} className="chart wide-chart" style={{ height: 28 + points.length * 30 }}>
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart layout="vertical" data={categoryBars(points, pickedCategory)} margin={{ top: 4, right: chartWidth < 560 ? 112 : 148, left: 8, bottom: 0 }}>
                      <CartesianGrid stroke="#eef1f4" horizontal={false} />
                      <XAxis type="number" tickFormatter={inrCompactText} tickLine={false} axisLine={false} />
                      <YAxis type="category" dataKey="category" width={CATEGORY_AXIS_WIDTH} tickLine={false} axisLine={false} interval={0} tick={<CategoryTick />} />
                      <Tooltip cursor={false} content={ChartTip} wrapperStyle={{ outline: "none", zIndex: 5 }} />
                      <Bar dataKey="total" barSize={16} radius={[0, 6, 6, 0]} onClick={(point) => void pickCategory(String(point.category ?? ""))}>
                        {categoryBars(points, pickedCategory).map((bar) => (
                          <Cell key={bar.category} fill={bar.fill} />
                        ))}
                        <LabelList
                          dataKey="caption"
                          content={(props) => (
                            <CategoryCaption
                              mid={captionMid(props.viewBox)}
                              value={props.value}
                              labelRight={Math.max(chartWidth - 12, 0)}
                            />
                          )}
                        />
                      </Bar>
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              )}
            </article>
            <TxnPanel
              key={txnListKey}
              rows={txns}
              from={from}
              to={to}
              filter={pickedCategory || pickedSource || (pickedFlow === "debit" ? "Debit" : pickedFlow === "credit" ? "Credit" : "this range")}
            />
          </div>
          <DetailCharts breakdown={breakdown} onPick={(source) => void pickSource(source)} />
        </section>
        {chatFits ? (
          <ChatPane
            messages={messages}
            draft={draft}
            busy={busy}
            status={status}
            openSql={openSql}
            showHeading
            onDraft={setDraft}
            onAsk={ask}
            onToggleSql={(id) => setOpenSql((current) => ({ ...current, [id]: !current[id] }))}
          />
        ) : null}
      </div>
      {chatFits ? null : (
        <>
          {chatOpen ? null : (
            <button
              type="button"
              className={`chat-fab${busy ? " busy" : ""}`}
              onClick={() => setChatOpen(true)}
              aria-label="Open AI chat"
            >
              <ChatIcon />
              {messages.length > 0 ? <span className="chat-fab-dot" /> : null}
            </button>
          )}
          {chatOpen ? (
            <div className="chat-backdrop" onClick={() => setChatOpen(false)}>
              <div
                className="chat-dialog"
                role="dialog"
                aria-modal="true"
                aria-labelledby="chat-dialog-title"
                onClick={(event) => event.stopPropagation()}
              >
                <div className="chat-dialog-head">
                  <h2 id="chat-dialog-title">Chat</h2>
                  <button type="button" className="ghost" onClick={() => setChatOpen(false)}>
                    Close
                  </button>
                </div>
                <ChatPane
                  messages={messages}
                  draft={draft}
                  busy={busy}
                  status={status}
                  openSql={openSql}
                  showHeading={false}
                  onDraft={setDraft}
                  onAsk={ask}
                  onToggleSql={(id) => setOpenSql((current) => ({ ...current, [id]: !current[id] }))}
                />
              </div>
            </div>
          ) : null}
        </>
      )}
    </div>
  );
}

function useChatFits(): boolean {
  const [fits, setFits] = useState(() => chatFitsWidth(typeof window === "undefined" ? 1280 : window.innerWidth));
  useEffect(() => {
    const update = (): void => setFits(chatFitsWidth(window.innerWidth));
    update();
    window.addEventListener("resize", update);
    return () => window.removeEventListener("resize", update);
  }, []);
  return fits;
}

function chatFitsWidth(width: number): boolean {
  const chatCol = Math.min(420, Math.max(320, width * 0.28));
  return width >= 1024 && width - chatCol >= 640;
}

function ChatIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" width="26" height="26" aria-hidden="true">
      <circle cx="12" cy="2.9" r="1.45" fill="currentColor" />
      <rect x="11.25" y="4.1" width="1.5" height="2.6" rx="0.75" fill="currentColor" />
      <rect x="3.55" y="10.8" width="1.7" height="4.4" rx="0.85" fill="currentColor" />
      <rect x="18.75" y="10.8" width="1.7" height="4.4" rx="0.85" fill="currentColor" />
      <path
        fill="currentColor"
        fillRule="evenodd"
        d="M6.2 7c-1.33 0-2.4 1.07-2.4 2.4v7.7c0 1.33 1.07 2.4 2.4 2.4h11.6c1.33 0 2.4-1.07 2.4-2.4V9.4c0-1.33-1.07-2.4-2.4-2.4H6.2zm2.85 4.15a1.55 1.55 0 1 0 0 3.1 1.55 1.55 0 0 0 0-3.1zm6.1 0a1.55 1.55 0 1 0 0 3.1 1.55 1.55 0 0 0 0-3.1zM9.35 16.2h5.3c.41 0 .75.34.75.75 0 .22-.1.42-.26.56-.86.72-2.02 1.14-3.14 1.14s-2.28-.42-3.14-1.14a.75.75 0 0 1-.26-.56c0-.41.34-.75.75-.75z"
      />
    </svg>
  );
}

function ChatPane({
  messages,
  draft,
  busy,
  status,
  openSql,
  showHeading,
  onDraft,
  onAsk,
  onToggleSql,
}: {
  messages: ChatMessage[];
  draft: string;
  busy: boolean;
  status: string;
  openSql: Record<string, boolean>;
  showHeading: boolean;
  onDraft: (value: string) => void;
  onAsk: (message: string) => Promise<void>;
  onToggleSql: (id: string) => void;
}): JSX.Element {
  return (
    <section className="chat">
      {showHeading ? <h2>Chat</h2> : null}
      <div className="transcript">
        {messages.length === 0 ? (
          <div className="chips">
            <p className="muted">Ask about a transaction or a total.</p>
            {CHIPS.map((chip) => (
              <button key={chip} type="button" className="ghost" onClick={() => void onAsk(chip)} disabled={busy}>
                {chip}
              </button>
            ))}
          </div>
        ) : null}
        {messages.map((message) => (
          <article key={message.id} className={`bubble ${message.role}${message.error ? " error" : ""}`}>
            <p>{message.pending && message.content.length === 0 ? "Working on the answer…" : message.content}</p>
            {message.error ? <p>{message.error}</p> : null}
            {message.chart ? <ChatChart chart={message.chart} /> : null}
            {message.rows.length > 0 ? <ResultTable rows={message.rows} /> : null}
            {message.sql ? (
              <div className="sql">
                <button type="button" className="ghost" onClick={() => onToggleSql(message.id)}>
                  {openSql[message.id] ? "Hide SQL" : "Show SQL"}
                </button>
                {openSql[message.id] ? <pre>{message.sql}</pre> : null}
              </div>
            ) : null}
          </article>
        ))}
      </div>
      <p className="status">{busy ? status || "Working…" : status}</p>
      <form
        className="composer"
        onSubmit={(event) => {
          event.preventDefault();
          void onAsk(draft.trim());
        }}
      >
        <textarea
          value={draft}
          onChange={(event) => onDraft(event.target.value)}
          placeholder="How much did I spend on eating out last month?"
          aria-label="Question"
        />
        <button type="submit" disabled={busy || draft.trim().length === 0}>
          Send
        </button>
      </form>
      <p className="muted">Answers use only your loaded statement.</p>
    </section>
  );
}

type TxnFilter = { category: string; source: string; flow: "" | "debit" | "credit" };

const OPEN_TXNS: TxnFilter = { category: "", source: "", flow: "" };

function categoryBars(
  points: CategoryPoint[],
  picked: string,
): Array<CategoryPoint & { caption: string; fill: string }> {
  const total = points.reduce((sum, point) => sum + point.total, 0);
  return points.map((point) => ({
    ...point,
    caption: `${inr.format(point.total)}|${total === 0 ? 0 : Math.round((point.total / total) * 100)}%`,
    fill: point.category === picked ? "#0f3d36" : "#5f9a90",
  }));
}

const CATEGORY_AXIS_WIDTH = 136;

function CategoryTick({ x, y, payload }: { x?: number; y?: number; payload?: { value?: string } }): JSX.Element {
  return (
    <text x={(x ?? 0) - CATEGORY_AXIS_WIDTH + 8} y={y} textAnchor="start" dominantBaseline="central" fontSize={12} fill="#142033">
      {categoryLabel(String(payload?.value ?? ""))}
    </text>
  );
}

function captionMid(viewBox: { y?: number; height?: number } | { cy?: number } | undefined): number {
  if (!viewBox || !("y" in viewBox)) return 0;
  return (viewBox.y ?? 0) + (viewBox.height ?? 0) / 2;
}

function CategoryCaption({
  mid,
  value,
  labelRight,
}: {
  mid: number;
  value?: string | number;
  labelRight: number;
}): JSX.Element | null {
  if (labelRight <= 0) return null;
  const [amount, share] = String(value ?? "").split("|");
  return (
    <text y={mid} fontSize={10} dominantBaseline="central">
      <tspan x={labelRight - 52} textAnchor="end" fill="#142033">
        {amount}
      </tspan>
      <tspan x={labelRight} textAnchor="end" fill="#5d6b7a">
        {share}
      </tspan>
    </text>
  );
}

function Kpi({ label, value, tone }: { label: string; value: string; tone: string }): JSX.Element {
  return (
    <article className={`kpi ${tone}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </article>
  );
}

function TxnPanel({ rows, from, to, filter }: { rows: TxnRow[]; from: string; to: string; filter: string }): JSX.Element {
  const [query, setQuery] = useState("");
  const [payee, setPayee] = useState("");
  const [category, setCategory] = useState("");
  const merchants = [...new Set(rows.map((row) => row.merchant))].filter((name) => name.length > 0).sort((a, b) => a.localeCompare(b));
  const categories = [...new Set(rows.map((row) => row.category))].filter((name) => name.length > 0).sort((a, b) => categoryLabel(a).localeCompare(categoryLabel(b)));
  const merchantKey = merchants.join("\0");
  const categoryKey = categories.join("\0");
  useEffect(() => {
    if (payee && !merchantKey.split("\0").includes(payee)) setPayee("");
  }, [payee, merchantKey]);
  useEffect(() => {
    if (category && !categoryKey.split("\0").includes(category)) setCategory("");
  }, [category, categoryKey]);
  const shown = rows.filter(
    (row) => (payee ? row.merchant === payee : true) && (category ? row.category === category : true) && matchesSearch(row, query),
  );
  const debitTotal = shown.reduce((sum, row) => sum + (row.direction === "debit" ? amountNumber(row.amount) : 0), 0);
  const creditTotal = shown.reduce((sum, row) => sum + (row.direction === "credit" ? amountNumber(row.amount) : 0), 0);
  return (
    <article className="card txn-card">
      <div className="card-head">
        <h2>Transactions · {transactionTitle(filter, from, to)}</h2>
        <button type="button" className="ghost" onClick={() => downloadCsv(shown)} disabled={shown.length === 0}>
          Export CSV
        </button>
      </div>
      <div className="txn-totals">
        <span>Debit <strong>{inr.format(debitTotal)}</strong></span>
        <span>Credit <strong>{inr.format(creditTotal)}</strong></span>
      </div>
      <div className="filter-row">
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder="Search payee, description, or amount"
          aria-label="Search transactions"
        />
      </div>
      <ResultTable
        rows={shown.map((row) => ({ ...row }))}
        columns={Object.keys(rows[0] ?? {})}
        payee={merchants.includes(payee) ? payee : ""}
        payees={merchants}
        onPayee={setPayee}
        category={categories.includes(category) ? category : ""}
        categories={categories}
        onCategory={setCategory}
      />
    </article>
  );
}

function transactionTitle(filter: string, from: string, to: string): string {
  const span = from && to ? `${formatDmy(from)} – ${formatDmy(to)}` : "This range";
  return filter && filter !== "this range" ? `${categoryLabel(filter)} · ${span}` : span;
}

function amountNumber(value: string): number {
  const parsed = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function matchesSearch(row: TxnRow, query: string): boolean {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  const compact = needle.replace(/,/g, "");
  return (
    row.merchant.toLowerCase().includes(needle) ||
    row.description.toLowerCase().includes(needle) ||
    row.amount.replace(/,/g, "").toLowerCase().includes(compact)
  );
}

function downloadCsv(rows: TxnRow[]): void {
  const header = ["txn_date", "merchant", "user_label", "category", "amount", "direction", "description"];
  const titles = header.map(columnTitle);
  const body = rows.map((row) => header.map((key) => csvCell(String(row[key as keyof TxnRow] ?? ""))).join(","));
  const blob = new Blob([[titles.join(","), ...body].join("\n")], { type: "text/csv" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "transactions.csv";
  link.click();
  URL.revokeObjectURL(url);
}

function csvCell(value: string): string {
  return `"${value.replace(/"/g, '""')}"`;
}

function ResultTable({
  rows,
  columns,
  payee,
  payees,
  onPayee,
  category,
  categories,
  onCategory,
}: {
  rows: ChatMessage["rows"];
  columns?: string[];
  payee?: string;
  payees?: string[];
  onPayee?: (value: string) => void;
  category?: string;
  categories?: string[];
  onCategory?: (value: string) => void;
}): JSX.Element {
  const headers = columns && columns.length > 0 ? columns : Object.keys(rows[0] ?? {});
  return (
    <div className="table-wrap">
      <table>
        <thead>
          <tr>
            {headers.map((column) => (
              <th key={column} className={`col-${column}`}>
                {column === "merchant" && onPayee && payees ? (
                  <select className="payee-filter" value={payee ?? ""} onChange={(event) => onPayee(event.target.value)} aria-label="Filter by payee">
                    <option value="">All payees</option>
                    {payees.map((name) => (
                      <option key={name} value={name}>
                        {name}
                      </option>
                    ))}
                  </select>
                ) : column === "category" && onCategory && categories ? (
                  <select className="payee-filter" value={category ?? ""} onChange={(event) => onCategory(event.target.value)} aria-label="Filter by category">
                    <option value="">All categories</option>
                    {categories.map((name) => (
                      <option key={name} value={name}>
                        {categoryLabel(name)}
                      </option>
                    ))}
                  </select>
                ) : (
                  columnTitle(column)
                )}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.length === 0 ? (
            <tr>
              <td className="empty-cell" colSpan={Math.max(headers.length, 1)}>
                No rows in this filter.
              </td>
            </tr>
          ) : (
            rows.map((row, index) => (
              <tr key={`${index}-${headers[0] ?? "row"}`}>
                {headers.map((column) => (
                  <td key={column} className={`col-${column}`} title={formatCell(row[column], column)}>
                    {formatCell(row[column], column)}
                  </td>
                ))}
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}

function formatCell(value: string | number | boolean | null | undefined, column?: string): string {
  if (value === null || value === undefined) return "";
  if (column === "category") return categoryLabel(String(value));
  if (column === "txn_date" || column === "value_date") return formatDmy(String(value)) || String(value);
  if (column === "direction") return titleWord(String(value));
  if (column === "source") return categoryLabel(String(value).replace(":", " "));
  return String(value);
}

function titleWord(value: string): string {
  if (!value) return "";
  return value.slice(0, 1).toUpperCase() + value.slice(1);
}
