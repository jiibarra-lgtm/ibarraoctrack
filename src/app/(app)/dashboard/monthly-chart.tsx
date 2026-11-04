"use client";
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";

const MONTHS = ["ene", "feb", "mar", "abr", "may", "jun", "jul", "ago", "sep", "oct", "nov", "dic"];
const label = (k: string) => {
  const [y, m] = k.split("-");
  return `${MONTHS[Number(m) - 1]} ${y.slice(2)}`;
};

export function MonthlyChart({ data, currency }: { data: Record<string, number | string>[]; currency: string }) {
  const compact = new Intl.NumberFormat("es-AR", { notation: "compact", maximumFractionDigits: 1 });
  const full = new Intl.NumberFormat("es-AR", { style: "currency", currency, maximumFractionDigits: 0 });
  return (
    <div className="h-64 w-full">
      <ResponsiveContainer>
        <BarChart data={data} margin={{ top: 8, right: 4, left: 0, bottom: 0 }}>
          <CartesianGrid vertical={false} stroke="var(--border)" />
          <XAxis dataKey="month" tickFormatter={label} tickLine={false} axisLine={false} tick={{ fontSize: 11, fill: "var(--fg-subtle)" }} interval="preserveStartEnd" />
          <YAxis tickFormatter={(v) => compact.format(v)} tickLine={false} axisLine={false} width={48} tick={{ fontSize: 11, fill: "var(--fg-subtle)" }} />
          <Tooltip
            cursor={{ fill: "var(--surface-2)" }}
            contentStyle={{ background: "var(--surface)", border: "1px solid var(--border)", borderRadius: 8, fontSize: 12, color: "var(--fg)" }}
            labelFormatter={(k) => label(String(k))}
            formatter={(v, name) => (name === "awarded" ? [full.format(Number(v)), "Adjudicado"] : [String(v), "Órdenes"])}
          />
          <Bar dataKey="awarded" fill="var(--primary)" radius={[4, 4, 0, 0]} maxBarSize={36} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
