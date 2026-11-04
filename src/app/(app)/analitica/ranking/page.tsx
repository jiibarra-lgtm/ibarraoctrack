import type { Metadata } from "next";
import Link from "next/link";
import { Suspense } from "react";
import { Trophy } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Badge, Card, EmptyState, PageHeader } from "@/components/ui/primitives";
import { StatusBadge } from "@/components/po/status-badge";
import { formatMoney } from "@/lib/format";
import { loadProfitability } from "@/lib/profitability";
import type { PoStatus } from "@/lib/po/schema";
import { cn } from "@/lib/utils";
import { RankingFilters } from "./ranking-filters";

export const metadata: Metadata = { title: "Ranking de órdenes" };

const VIEWS = {
  ganancia: { label: "Mayor ganancia", sort: (r: R) => -n(r.profit) },
  margen: { label: "Mayor margen", sort: (r: R) => -n(r.margin) },
  menor: { label: "Menor margen", sort: (r: R) => n(r.margin) },
  perdidas: { label: "Con pérdidas", sort: (r: R) => n(r.profit) },
  costos: { label: "Mayores costos", sort: (r: R) => -n(r.costs) },
  volumen: { label: "Mayor volumen", sort: (r: R) => -Number(r.sales) },
} as const;
type View = keyof typeof VIEWS;
type R = { id: string; label: string; customer: string | null; status: PoStatus; currency: string; sales: string; costs: string | null; profit: string | null; margin: string | null; delivered: string; purchased: string; min: number; complete: boolean };
const n = (v: string | null) => (v === null ? Number.POSITIVE_INFINITY : Number(v));

export default async function RankingPage({ searchParams }: { searchParams: Promise<{ vista?: string; base?: string; desde?: string; hasta?: string; organismo?: string; estado?: string }> }) {
  const sp = await searchParams;
  const view: View = (sp.vista && sp.vista in VIEWS ? sp.vista : "ganancia") as View;
  const base = sp.base === "realizada" ? "realizada" : "estimada";
  const s = await requireOrg();

  let oq = s.supabase.from("purchase_orders_overview").select("id, bac_number, display_number, customer_id, customer_name, status, issue_date").eq("org_id", s.org.org_id).neq("status", "anulada");
  if (sp.desde) oq = oq.gte("issue_date", sp.desde);
  if (sp.hasta) oq = oq.lte("issue_date", sp.hasta);
  if (sp.organismo) oq = oq.eq("customer_id", sp.organismo);
  if (sp.estado) oq = oq.eq("status", sp.estado);
  const [{ data: orders }, { data: customers }] = await Promise.all([oq, s.supabase.from("customers").select("id, name").eq("org_id", s.org.org_id).order("name")]);
  const prof = await loadProfitability(s.supabase, s.org.org_id, (orders ?? []).map((o) => o.id));
  const byId = new Map(prof.map((p) => [p.purchase_order_id, p]));

  let rows: R[] = (orders ?? []).map((o) => {
    const p = byId.get(o.id)!;
    const realized = base === "realizada";
    const costs = realized
      ? (p?.cost_delivered != null ? (Number(p.cost_delivered) + Number(p.other_costs_delivered ?? 0)).toFixed(2) : null)
      : (p?.direct_cost_estimated != null ? (Number(p.direct_cost_estimated) + Number(p.other_costs)).toFixed(2) : null);
    return {
      id: o.id, label: o.bac_number ?? o.display_number, customer: o.customer_name, status: o.status as PoStatus, currency: p?.currency ?? "ARS",
      sales: realized ? p?.sales_delivered_net ?? "0" : p?.sales_net ?? "0", costs,
      profit: realized ? p?.operating_profit_realized ?? null : p?.operating_profit_estimated ?? null,
      margin: realized ? p?.operating_margin_realized ?? null : p?.operating_margin_estimated ?? null,
      delivered: p?.delivered_pct ?? "0", purchased: p?.purchased_pct ?? "0", min: Number(p?.min_margin_pct ?? 15),
      complete: Boolean(p?.cost_estimate_complete),
    };
  });
  const withCost = rows.filter((r) => r.profit !== null && (base === "estimada" || Number(r.sales) > 0));
  const missing = rows.length - withCost.length;
  rows = withCost;
  if (view === "perdidas") rows = rows.filter((r) => Number(r.profit) < 0);
  rows.sort((a, b) => VIEWS[view].sort(a) - VIEWS[view].sort(b));

  const qs = (patch: Record<string, string>) => {
    const p = new URLSearchParams(Object.entries({ ...sp, ...patch }).filter(([, v]) => v) as [string, string][]);
    return `?${p.toString()}`;
  };

  return (
    <>
      <PageHeader title="Ranking de órdenes" description="Ganancia operativa = ventas netas − costo de mercadería − gastos asignados. La ganancia no es dinero cobrado." />
      <div className="mb-4 flex flex-col gap-3">
        <div className="flex flex-wrap items-center gap-2">
          <div className="inline-flex rounded-md border border-border p-0.5">
            {(["estimada", "realizada"] as const).map((b) => (
              <Link key={b} href={qs({ base: b })} className={cn("rounded px-3 py-1.5 text-sm", base === b ? "bg-primary text-primary-fg" : "text-fg-muted hover:text-fg")}>
                {b === "estimada" ? "Estimada (orden completa)" : "Realizada (lo entregado)"}
              </Link>
            ))}
          </div>
          <div className="flex flex-wrap gap-1">
            {(Object.keys(VIEWS) as View[]).map((v) => (
              <Link key={v} href={qs({ vista: v })} className={cn("rounded-full border px-3 py-1 text-xs", view === v ? "border-primary bg-info-soft text-primary" : "border-border text-fg-muted hover:text-fg")}>{VIEWS[v].label}</Link>
            ))}
          </div>
        </div>
        <Suspense><RankingFilters customers={customers ?? []} /></Suspense>
      </div>
      <Card className="overflow-hidden">
        {!rows.length ? (
          <EmptyState icon={<Trophy />} title={view === "perdidas" ? "Ninguna orden con pérdida" : "Sin órdenes con costos para rankear"}
            description={missing ? `${missing} órdenes todavía no tienen costo cargado (compras o costo estimado por renglón).` : undefined} />
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead><tr className="border-b border-border bg-surface-2/50 text-left text-xs text-fg-muted">
                <th className="px-4 py-2.5 font-medium">#</th><th className="px-4 py-2.5 font-medium">Orden</th><th className="px-4 py-2.5 font-medium">Estado</th>
                <th className="px-4 py-2.5 text-right font-medium">Ventas netas</th><th className="px-4 py-2.5 text-right font-medium">Costos</th>
                <th className="px-4 py-2.5 text-right font-medium">Ganancia {base}</th><th className="px-4 py-2.5 text-right font-medium">Margen</th>
                <th className="px-4 py-2.5 text-right font-medium">Comprado</th><th className="px-4 py-2.5 text-right font-medium">Entregado</th>
              </tr></thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.id} className="border-b border-border last:border-0 hover:bg-surface-2/50">
                    <td className="px-4 py-3 text-fg-subtle tabular">{i + 1}</td>
                    <td className="px-4 py-3"><Link href={`/ordenes/${r.id}`} className="font-medium hover:text-primary">{r.label}</Link><p className="line-clamp-1 max-w-56 text-xs text-fg-subtle">{r.customer}</p></td>
                    <td className="px-4 py-3"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-3 text-right tabular">{formatMoney(r.sales, r.currency)}</td>
                    <td className="px-4 py-3 text-right tabular">{formatMoney(r.costs, r.currency)}</td>
                    <td className={cn("px-4 py-3 text-right font-medium tabular", Number(r.profit) < 0 && "text-danger")}>{formatMoney(r.profit, r.currency)}</td>
                    <td className="px-4 py-3 text-right">
                      <Badge tone={Number(r.margin) < 0 ? "danger" : Number(r.margin) < r.min ? "warn" : "accent"}>{r.margin ?? "—"}%</Badge>
                      {base === "estimada" && !r.complete && <p className="mt-0.5 text-[10px] text-fg-subtle">costo parcial</p>}
                    </td>
                    <td className="px-4 py-3 text-right tabular text-fg-muted">{Number(r.purchased).toFixed(0)}%</td>
                    <td className="px-4 py-3 text-right tabular text-fg-muted">{Number(r.delivered).toFixed(0)}%</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      {missing > 0 && rows.length > 0 && <p className="mt-2 text-xs text-fg-subtle">{missing} órdenes sin costo cargado no aparecen en el ranking.</p>}
    </>
  );
}
