"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";

const axis = { stroke: "#6b6b6b", fontSize: 11 };
const grid = "#242424";
const tooltipStyle = {
  background: "#0b0b0b",
  border: "1px solid #242424",
  borderRadius: 12,
  fontSize: 12,
  color: "#ffffff",
} as const;

export function EquityCurve({ data }: { data: Array<{ time: string; equityUsd: number }> }) {
  const points = data.map((d, i) => ({ i, equityUsd: d.equityUsd }));
  return (
    <ResponsiveContainer width="100%" height={240}>
      <AreaChart data={points} margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <defs>
          <linearGradient id="eq" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#00ff88" stopOpacity={0.4} />
            <stop offset="100%" stopColor="#00ff88" stopOpacity={0} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={grid} vertical={false} />
        <XAxis dataKey="i" tick={axis} tickLine={false} axisLine={{ stroke: grid }} />
        <YAxis
          tick={axis}
          tickLine={false}
          axisLine={{ stroke: grid }}
          width={56}
          domain={["auto", "auto"]}
          tickFormatter={(v: number) => `$${Math.round(v).toLocaleString()}`}
        />
        <Tooltip
          contentStyle={tooltipStyle}
          formatter={(v: number) => [`$${v.toFixed(2)}`, "Equity"]}
          labelFormatter={(i) => `Bar ${i}`}
        />
        <Area type="monotone" dataKey="equityUsd" stroke="#00ff88" strokeWidth={2} fill="url(#eq)" />
      </AreaChart>
    </ResponsiveContainer>
  );
}

export function RejectionBars({ data }: { data: Array<{ code: string; count: number }> }) {
  const short = data.map((d) => ({ ...d, label: d.code.replace("REJECT_", "") }));
  return (
    <ResponsiveContainer width="100%" height={Math.max(120, short.length * 38)}>
      <BarChart data={short} layout="vertical" margin={{ top: 4, right: 16, bottom: 4, left: 8 }}>
        <CartesianGrid stroke={grid} horizontal={false} />
        <XAxis type="number" tick={axis} tickLine={false} axisLine={{ stroke: grid }} allowDecimals={false} />
        <YAxis
          type="category"
          dataKey="label"
          tick={{ ...axis, fontSize: 10 }}
          tickLine={false}
          axisLine={{ stroke: grid }}
          width={130}
        />
        <Tooltip
          cursor={{ fill: "rgba(255,255,255,0.03)" }}
          contentStyle={tooltipStyle}
        />
        <Bar dataKey="count" radius={[0, 4, 4, 0]}>
          {short.map((_, i) => (
            <Cell key={i} fill="#fb7185" fillOpacity={0.8} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
