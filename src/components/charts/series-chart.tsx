"use client";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

import { monthLabel } from "@/lib/months";

/** Paleta de series: celeste, azul petróleo, verde, ámbar (validada en claro y oscuro). */
const COLORS = ["var(--chart)", "oklch(0.45 0.08 240)", "oklch(0.64 0.13 162)", "oklch(0.74 0.14 70)", "oklch(0.6 0.17 25)"];

export type Series = { key: string; label: string };

export function SeriesChart({ data, series, currency = "ARS", type = "bar", height = 260, xKey = "month", percent = false }: {
  data: Record<string, number | string>[]; series: Series[]; currency?: string; type?: "bar" | "line"; height?: number; xKey?: string; percent?: boolean;
}) {
  const compact = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });
  const full = percent
    ? { format: (v: number) => `${v.toLocaleString("es-AR", { maximumFractionDigits: 1 })}%` }
    : new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 });
  const common = {
    data, margin: { top: 8, right: 8, left: 0, bottom: 0 },
  };
  const axes = (
    <>
      <CartesianGrid vertical={false} stroke="var(--border)" />
      <XAxis dataKey={xKey} tickFormatter={xKey === "month" ? monthLabel : undefined} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--fg-subtle)" }} interval="preserveStartEnd" />
      <YAxis tickFormatter={(v) => (percent ? `${v}%` : compact.format(v))} tickLine={false} axisLine={false} width={52} tick={{ fontSize: 11, fill: "var(--fg-subtle)" }} />
      <Tooltip
        cursor={{ fill: "var(--surface-2)" }}
        contentStyle={{ background: "var(--surface-solid)", border: "1px solid var(--border)", borderRadius: 10, fontSize: 12, color: "var(--fg)" }}
        labelFormatter={(l) => (xKey === "month" ? monthLabel(String(l)) : String(l))}
        formatter={(v, name) => [full.format(Number(v)), series.find((s) => s.key === name)?.label ?? String(name)]}
      />
      {series.length > 1 && <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} formatter={(v) => series.find((s) => s.key === v)?.label ?? v} />}
    </>
  );
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer>
        {type === "line" ? (
          <LineChart {...common}>
            {axes}
            {series.map((s, i) => <Line key={s.key} dataKey={s.key} stroke={COLORS[i % COLORS.length]} strokeWidth={2.2} dot={false} type="monotone" />)}
          </LineChart>
        ) : (
          <BarChart {...common} barGap={2}>
            {axes}
            {series.map((s, i) => <Bar key={s.key} dataKey={s.key} fill={COLORS[i % COLORS.length]} radius={[5, 5, 0, 0]} maxBarSize={26} />)}
          </BarChart>
        )}
      </ResponsiveContainer>
    </div>
  );
}
