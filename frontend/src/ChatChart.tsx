import { Cell, Legend, Line, LineChart, Pie, PieChart, Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { JSX } from "react";
import type { ChartSpec } from "./types";

const FILLS = ["#5f9a90", "#e8a06a", "#6b9ae8", "#d98958", "#c47a72", "#6f9bbd", "#a8b2bc"];

interface ChartProps {
  chart: ChartSpec;
  width?: number;
  height?: number;
}

export function ChatChart({ chart }: { chart: ChartSpec }): JSX.Element {
  return (
    <div className="chat-chart">
      <p className="muted">{chart.title}</p>
      <div className="chat-chart-body">
        <ResponsiveContainer width="100%" height="100%">
          {chart.type === "donut" ? <Donut chart={chart} /> : chart.type === "line" ? <BalanceLine chart={chart} /> : <Bars chart={chart} />}
        </ResponsiveContainer>
      </div>
    </div>
  );
}

function Bars({ chart, width, height }: ChartProps): JSX.Element {
  const yKey = chart.yKeys[0] ?? "total";
  const second = chart.yKeys[1];
  return (
    <BarChart width={width} height={height} data={chart.data} barCategoryGap="28%" barGap={6}>
      <CartesianGrid stroke="#eef1f4" vertical={false} />
      <XAxis dataKey={chart.xKey} tickLine={false} axisLine={false} interval={0} />
      <YAxis tickLine={false} axisLine={false} width={40} />
      <Tooltip cursor={false} />
      {second ? (
        [
          <Bar key={yKey} dataKey={yKey} fill="#5f9a90" barSize={16} isAnimationActive={false} />,
          <Bar key={second} dataKey={second} fill="#c47a72" barSize={16} isAnimationActive={false} />,
        ]
      ) : (
        <Bar dataKey={yKey} fill="#5f9a90" maxBarSize={28} isAnimationActive={false} />
      )}
    </BarChart>
  );
}

function BalanceLine({ chart, width, height }: ChartProps): JSX.Element {
  const yKey = chart.yKeys[0] ?? "balance";
  return (
    <LineChart width={width} height={height} data={chart.data}>
      <CartesianGrid stroke="#eef1f4" vertical={false} />
      <XAxis dataKey={chart.xKey} tickLine={false} axisLine={false} />
      <YAxis tickLine={false} axisLine={false} width={40} />
      <Tooltip />
      <Line type="monotone" dataKey={yKey} stroke="#5f9a90" dot={false} isAnimationActive={false} />
    </LineChart>
  );
}

function Donut({ chart, width, height }: ChartProps): JSX.Element {
  const yKey = chart.yKeys[0] ?? "total";
  return (
    <PieChart width={width} height={height}>
      <Pie data={chart.data} dataKey={yKey} nameKey={chart.xKey} innerRadius={36} outerRadius={62} isAnimationActive={false}>
        {chart.data.map((row, index) => (
          <Cell key={String(row[chart.xKey])} fill={fillFor(String(row[chart.xKey]), index)} />
        ))}
      </Pie>
      <Tooltip />
      <Legend />
    </PieChart>
  );
}

function fillFor(name: string, index: number): string {
  if (/unknown|other/i.test(name)) return "#a8b2bc";
  return FILLS[index % FILLS.length] ?? "#5f9a90";
}
