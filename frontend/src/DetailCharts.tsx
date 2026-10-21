import { Bar, CartesianGrid, Cell, ComposedChart, Legend, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { JSX } from "react";
import { inr, inrCompactText, monthIsPartial, monthTick } from "./format";
import type { BreakdownResponse, CashflowTotal, SourceTotal } from "./types";

interface Series {
  key: string;
  label: string;
  color: string;
}

const SERIES_BY_KEY: Record<string, Series> = {
  "grocery:dmart": { key: "grocery:dmart", label: "DMart", color: "#5c6b7a" },
  "grocery:blinkit": { key: "grocery:blinkit", label: "Blinkit", color: "#c4a15a" },
  "grocery:flipkart": { key: "grocery:flipkart", label: "Flipkart", color: "#7d8fb5" },
  "grocery:amazon": { key: "grocery:amazon", label: "Amazon", color: "#b08a6a" },
  "grocery:other": { key: "grocery:other", label: "Other", color: "#a8b2bc" },
  "food:swiggy": { key: "food:swiggy", label: "Swiggy", color: "#d98958" },
  "food:zomato": { key: "food:zomato", label: "Zomato", color: "#c4473a" },
  "food:dominos": { key: "food:dominos", label: "Domino's", color: "#3d6f8f" },
  "food:pizzahut": { key: "food:pizzahut", label: "Pizza Hut", color: "#b55248" },
  "food:kfc": { key: "food:kfc", label: "KFC", color: "#8d4a3a" },
  "food:mcdonalds": { key: "food:mcdonalds", label: "McDonald's", color: "#c4a15a" },
  "food:burgerking": { key: "food:burgerking", label: "Burger King", color: "#7d4e3a" },
  "food:subway": { key: "food:subway", label: "Subway", color: "#3f7d4a" },
  "food:hotel": { key: "food:hotel", label: "Hotel", color: "#8d97a3" },
  "food:other": { key: "food:other", label: "Other", color: "#a8b2bc" },
};

const SERIES_ORDER = Object.keys(SERIES_BY_KEY);
const EXTRA_COLORS = ["#6d7f99", "#b08a6a", "#5c6b7a", "#7d8fb5"];

export function DetailCharts({
  breakdown,
  onPick,
}: {
  breakdown: BreakdownResponse | null;
  onPick: (source: string) => void;
}): JSX.Element | null {
  if (!breakdown || !breakdown.from || !breakdown.to) return null;
  const monthly = breakdown.from.slice(0, 7) !== breakdown.to.slice(0, 7);
  return (
    <section className="details">
      <SourceChart title="Groceries by shop" note="Flipkart and Amazon stay under shopping on the category chart." rows={breakdown.grocery} monthly={monthly} from={breakdown.from} to={breakdown.to} onPick={onPick} />
      <SourceChart title="Food by source" rows={breakdown.food} monthly={monthly} from={breakdown.from} to={breakdown.to} onPick={onPick} />
      <SourceChart title="Investment" note="Money put into mutual funds and brokers. This is not spending." rows={breakdown.investment ?? []} monthly={monthly} from={breakdown.from} to={breakdown.to} onPick={onPick} />
      <CashflowChart rows={breakdown.cashflow} monthly={monthly} from={breakdown.from} to={breakdown.to} />
    </section>
  );
}

function SourceChart({
  title,
  note,
  rows,
  monthly,
  from,
  to,
  onPick,
}: {
  title: string;
  note?: string;
  rows: SourceTotal[];
  monthly: boolean;
  from: string;
  to: string;
  onPick: (source: string) => void;
}): JSX.Element | null {
  const series = seriesPresent(rows);
  if (series.length === 0) return null;
  const data = monthly ? monthlyRows(rows, series, from, to) : singleRows(rows, series);
  const single = singleRows(rows, series);
  return (
    <article className="card">
      <h2>{title}</h2>
      {note ? <p className="muted">{note}</p> : null}
      <div className="chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} barCategoryGap="28%" barGap={6}>
            <CartesianGrid stroke="#eef1f4" vertical={false} />
            <XAxis dataKey="label" interval={0} tickLine={false} axisLine={false} height={48} />
            <YAxis tickLine={false} axisLine={false} width={56} tickFormatter={inrCompactText} />
            <Tooltip cursor={false} content={ChartTip} wrapperStyle={{ outline: "none", zIndex: 5 }} />
            {monthly ? <Legend /> : null}
            {monthly
              ? series.map((item) => (
                  <Bar key={item.key} dataKey={item.label} fill={item.color} maxBarSize={26} radius={[4, 4, 0, 0]} onClick={() => onPick(item.key)}>
                    {data.map((row) => (
                      <Cell key={`${item.key}-${String(row.label)}`} fill={item.color} fillOpacity={row.partial ? 0.45 : 1} />
                    ))}
                  </Bar>
                ))
              : (
                  <Bar dataKey="total" maxBarSize={46} radius={[6, 6, 0, 0]} onClick={(point) => pickLabel(point, series, onPick)}>
                    {single.map((item) => (
                      <Cell key={item.label} fill={series.find((entry) => entry.label === item.label)?.color ?? "#8d97a3"} />
                    ))}
                  </Bar>
                )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

function CashflowChart({
  rows,
  monthly,
  from,
  to,
}: {
  rows: CashflowTotal[];
  monthly: boolean;
  from: string;
  to: string;
}): JSX.Element {
  const data = monthly
    ? monthsBetween(from, to).map((period) => {
        const row = rows.find((item) => String(item.period).slice(0, 7) === period);
        return {
          label: monthTick(period, from, to),
          partial: monthIsPartial(period, from, to),
          "Money in": amountOf(row?.credit),
          "Money out": amountOf(row?.debit),
          Net: amountOf(row?.credit) - amountOf(row?.debit),
          Balance: amountOf(row?.closing),
        };
      })
    : [
        { label: "Money in", total: rows.reduce((sum, row) => sum + Number(row.credit), 0), partial: false },
        { label: "Money out", total: rows.reduce((sum, row) => sum + Number(row.debit), 0), partial: false },
      ];
  return (
    <article className="card">
      <h2>Cash movement</h2>
      <p className="muted">Every credit and every debit. This is not profit and loss.</p>
      <div className="chart">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={data} barCategoryGap="28%" barGap={8}>
            <CartesianGrid stroke="#eef1f4" vertical={false} />
            <XAxis dataKey="label" interval={0} tickLine={false} axisLine={false} height={48} />
            <YAxis yAxisId="money" tickLine={false} axisLine={false} width={56} tickFormatter={inrCompactText} />
            <YAxis yAxisId="balance" orientation="right" tickLine={false} axisLine={false} width={56} tickFormatter={inrCompactText} />
            <Tooltip cursor={false} content={ChartTip} wrapperStyle={{ outline: "none", zIndex: 5 }} />
            {monthly ? <Legend /> : null}
            {monthly ? (
              [
                <Bar key="in" yAxisId="money" dataKey="Money in" fill="#2f7d4a" barSize={18} isAnimationActive={false}>
                  {data.map((row) => (
                    <Cell key={`in-${String(row.label)}`} fill="#2f7d4a" fillOpacity={row.partial ? 0.45 : 1} />
                  ))}
                </Bar>,
                <Bar key="out" yAxisId="money" dataKey="Money out" fill="#b55248" barSize={18} isAnimationActive={false}>
                  {data.map((row) => (
                    <Cell key={`out-${String(row.label)}`} fill="#b55248" fillOpacity={row.partial ? 0.45 : 1} />
                  ))}
                </Bar>,
                <Line key="net" yAxisId="money" dataKey="Net" stroke="#1f3a5f" dot={false} isAnimationActive={false} />,
                <Line key="balance" yAxisId="balance" dataKey="Balance" stroke="#8d97a3" dot={false} isAnimationActive={false} />,
              ]
            ) : (
              <Bar yAxisId="money" dataKey="total" barSize={46} isAnimationActive={false}>
                <Cell fill="#2f7d4a" />
                <Cell fill="#b55248" />
              </Bar>
            )}
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    </article>
  );
}

interface TipRow {
  name?: string | number;
  value?: string | number;
  color?: string;
  dataKey?: string | number;
}

export function ChartTip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: TipRow[];
  label?: string | number;
}): JSX.Element | null {
  if (!active || !payload || payload.length === 0) return null;
  const rows = payload.filter((item) => item.name !== undefined);
  return (
    <div className="tip">
      {label !== undefined && label !== "" ? <p className="tip-title">{label}</p> : null}
      <div className={rows.length > 1 ? "tip-grid" : "tip-list"}>
        {rows.map((item) => (
          <p key={String(item.dataKey ?? item.name)} className="tip-item">
            <span className="tip-swatch" style={{ background: item.color ?? "#5f9a90" }} />
            <span>{item.name}</span>
            <strong>{inr.format(amountOf(item.value))}</strong>
          </p>
        ))}
      </div>
    </div>
  );
}

function amountOf(value: string | number | null | undefined): number {
  const parsed = typeof value === "number" ? value : Number(String(value ?? "0").replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function pickLabel(point: { label?: string }, series: Series[], onPick: (source: string) => void): void {
  const key = series.find((item) => item.label === point.label)?.key;
  if (key) onPick(key);
}

function seriesPresent(rows: SourceTotal[]): Series[] {
  const present = new Set(rows.filter((row) => Number(row.total) > 0).map((row) => row.source));
  const known = SERIES_ORDER.filter((key) => present.has(key)).map((key) => SERIES_BY_KEY[key]).filter((item): item is Series => item !== undefined);
  const extra = [...present]
    .filter((key) => !SERIES_BY_KEY[key])
    .sort()
    .map((key, index) => ({
      key,
      label: labelForSource(key),
      color: EXTRA_COLORS[index % EXTRA_COLORS.length] ?? "#8d97a3",
    }));
  return [...known, ...extra];
}

function labelForSource(source: string): string {
  const name = source.split(":")[1] ?? source;
  return name.replace(/[_-]+/g, " ").replace(/\b\w/g, (letter) => letter.toUpperCase());
}

function singleRows(rows: SourceTotal[], series: Series[]): Array<{ label: string; total: number; partial: boolean }> {
  return series.map((item) => ({
    label: item.label,
    total: rows.filter((row) => row.source === item.key).reduce((sum, row) => sum + Number(row.total), 0),
    partial: false,
  }));
}

function monthlyRows(rows: SourceTotal[], series: Series[], from: string, to: string): Array<Record<string, string | number | boolean>> {
  return monthsBetween(from, to).map((period) => {
    const point: Record<string, string | number | boolean> = {
      label: monthTick(period, from, to),
      partial: monthIsPartial(period, from, to),
    };
    for (const item of series) {
      const match = rows.find((row) => row.period === period && row.source === item.key);
      point[item.label] = Number(match?.total ?? 0);
    }
    return point;
  });
}

function monthsBetween(from: string, to: string): string[] {
  const start = new Date(Date.UTC(Number(from.slice(0, 4)), Number(from.slice(5, 7)) - 1, 1));
  const end = new Date(Date.UTC(Number(to.slice(0, 4)), Number(to.slice(5, 7)) - 1, 1));
  const months: string[] = [];
  const cursor = new Date(start);
  while (cursor <= end) {
    const month = String(cursor.getUTCMonth() + 1).padStart(2, "0");
    months.push(`${cursor.getUTCFullYear()}-${month}`);
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}
