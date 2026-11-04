import type { Metadata } from "next";
import { requireOrg } from "@/lib/session";
import { Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { loadMonthlyFlows } from "@/lib/billing-load";
import { SeriesChart } from "@/components/charts/series-chart";
import { monthLabel } from "@/lib/months";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Últimos 12 meses" };

const METRICS = [
  ["awarded", "Adjudicado"], ["invoiced", "Facturado"], ["collected", "Cobrado"], ["purchases", "Compras"], ["expenses", "Gastos"],
] as const;
type M = (typeof METRICS)[number][0];

function Var({ cur, prev }: { cur: number; prev: number }) {
  if (!prev) return <span className="text-fg-subtle">{cur ? "nuevo" : "—"}</span>;
  const v = ((cur - prev) / prev) * 100;
  return <span className={cn("tabular", v > 0 ? "text-accent" : v < 0 ? "text-danger" : "text-fg-subtle")}>{v > 0 ? "+" : ""}{v.toFixed(0)}%</span>;
}

export default async function Last12Page() {
  const s = await requireOrg();
  const [cur, prev] = await Promise.all([
    loadMonthlyFlows(s.supabase, s.org.org_id, "ARS", 12),
    loadMonthlyFlows(s.supabase, s.org.org_id, "ARS", 12, 12),
  ]);
  const tot = (rows: typeof cur, k: M) => rows.reduce((a, r) => a + r[k], 0);
  const chart = cur.map((r, i) => ({ month: r.month, actual: r.awarded, anterior: prev[i]?.awarded ?? 0 }));

  return (
    <>
      <PageHeader title="Últimos 12 meses" description="Mes a mes contra el mismo mes del año anterior. Importes en ARS." />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        {METRICS.map(([k, l]) => (
          <div key={k} className="glass rounded-2xl px-4 py-3.5">
            <p className="text-xs text-fg-muted">{l}</p>
            <p className="mt-1 truncate text-lg font-semibold tabular">{formatMoney(tot(cur, k).toFixed(2))}</p>
            <p className="text-xs">vs año anterior <Var cur={tot(cur, k)} prev={tot(prev, k)} /></p>
          </div>
        ))}
      </div>
      <Card className="mt-5">
        <CardHeader title="Adjudicado: este período vs el anterior" />
        <CardBody className="pt-2"><SeriesChart data={chart} series={[{ key: "actual", label: "Últimos 12 meses" }, { key: "anterior", label: "12 meses anteriores" }]} type="line" /></CardBody>
      </Card>
      <Card className="mt-5 overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead><tr className="border-b border-border text-xs text-fg-subtle">
              <th className="px-4 py-2.5 text-left font-medium sm:px-5">Mes</th>
              {METRICS.map(([k, l]) => <th key={k} className="px-3 py-2.5 text-right font-medium">{l}</th>)}
              <th className="px-4 py-2.5 text-right font-medium sm:px-5">Adjudicado vs año ant.</th>
            </tr></thead>
            <tbody className="divide-y divide-border">
              {[...cur].reverse().map((r) => {
                const p = prev[cur.indexOf(r)];
                return (
                  <tr key={r.month}>
                    <td className="px-4 py-2.5 capitalize sm:px-5">{monthLabel(r.month)}</td>
                    {METRICS.map(([k]) => <td key={k} className={cn("px-3 py-2.5 text-right tabular", !r[k] && "text-fg-subtle")}>{r[k] ? formatMoney(r[k].toFixed(2)) : "—"}</td>)}
                    <td className="px-4 py-2.5 text-right sm:px-5"><Var cur={r.awarded} prev={p?.awarded ?? 0} /></td>
                  </tr>
                );
              })}
              <tr className="bg-surface-2/60 font-medium">
                <td className="px-4 py-2.5 sm:px-5">Total</td>
                {METRICS.map(([k]) => <td key={k} className="px-3 py-2.5 text-right tabular">{formatMoney(tot(cur, k).toFixed(2))}</td>)}
                <td className="px-4 py-2.5 text-right sm:px-5"><Var cur={tot(cur, "awarded")} prev={tot(prev, "awarded")} /></td>
              </tr>
            </tbody>
          </table>
        </div>
      </Card>
    </>
  );
}
