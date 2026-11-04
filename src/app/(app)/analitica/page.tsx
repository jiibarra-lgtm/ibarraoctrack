import type { Metadata } from "next";
import Link from "next/link";
import { BadgePercent, FileText, Landmark, TrendingUp } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Card, CardBody, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatMoney, formatQty, todayISO } from "@/lib/format";
import { dec, sum } from "@/lib/money";
import { loadProfitability } from "@/lib/profitability";
import { loadMonthlyFlows } from "@/lib/billing-load";
import { SeriesChart } from "@/components/charts/series-chart";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Analítica" };

const PERIODS = [["12m", "Últimos 12 meses"], ["anio", "Este año"], ["todo", "Todo"]] as const;
const BUCKETS = [
  { label: "Pérdida", test: (m: number) => m < 0 }, { label: "0–10%", test: (m: number) => m >= 0 && m < 10 },
  { label: "10–20%", test: (m: number) => m >= 10 && m < 20 }, { label: "20–30%", test: (m: number) => m >= 20 && m < 30 },
  { label: "+30%", test: (m: number) => m >= 30 },
];

export default async function AnalyticsPage({ searchParams }: { searchParams: Promise<{ p?: string }> }) {
  const { p = "12m" } = await searchParams;
  const s = await requireOrg();
  const sb = s.supabase;
  const today = todayISO();
  const from = p === "anio" ? `${today.slice(0, 4)}-01-01`
    : p === "todo" ? "0000-01-01"
    : new Date(new Date(`${today}T12:00:00Z`).getTime() - 365 * 864e5).toISOString().slice(0, 10);

  const [profit, flows, { data: pos }] = await Promise.all([
    loadProfitability(sb, s.org.org_id),
    loadMonthlyFlows(sb, s.org.org_id, "ARS", 12),
    sb.from("purchase_orders_overview").select("id, customer_id, customer_name").eq("org_id", s.org.org_id).limit(5000),
  ]);
  const cust = new Map((pos ?? []).map((o) => [o.id as string, { id: o.customer_id as string | null, name: (o.customer_name as string | null) ?? "Sin organismo" }]));
  const rows = profit.filter((r) => r.currency === "ARS" && r.status !== "anulada" && (r.issue_date ?? "0000") >= from);
  const ids = rows.map((r) => r.purchase_order_id);
  const { data: items } = await sb.from("purchase_order_items").select("purchase_order_id, product_id, description_original, quantity, total_amount, products(name)")
    .in("purchase_order_id", ids.length ? ids : ["00000000-0000-0000-0000-000000000000"]).limit(20000);

  const withCost = rows.filter((r) => r.operating_profit_estimated !== null);
  const sales = sum(rows.map((r) => r.sales_gross));
  const profitSum = sum(withCost.map((r) => r.operating_profit_estimated));
  const salesWithCost = sum(withCost.map((r) => r.sales_net));
  const margin = Number(salesWithCost) > 0 ? dec(profitSum).div(salesWithCost).mul(100).toFixed(1) : null;

  // Margen por mes (ponderado) para el gráfico
  const byMonth = new Map<string, { s: string[]; p: string[] }>();
  withCost.forEach((r) => {
    const k = (r.issue_date ?? "").slice(0, 7);
    const g = byMonth.get(k) ?? { s: [], p: [] };
    g.s.push(r.sales_net); g.p.push(r.operating_profit_estimated!);
    byMonth.set(k, g);
  });
  const marginSeries = flows.map((f) => {
    const g = byMonth.get(f.month);
    return { month: f.month, margin: g && Number(sum(g.s)) > 0 ? Number(dec(sum(g.p)).div(sum(g.s)).mul(100).toFixed(1)) : 0 };
  });

  // Organismos
  const orgs = new Map<string, { name: string; n: number; sales: string[]; profit: string[]; net: string[] }>();
  rows.forEach((r) => {
    const c = cust.get(r.purchase_order_id) ?? { id: null, name: "Sin organismo" };
    const k = c.id ?? "—";
    const g = orgs.get(k) ?? { name: c.name, n: 0, sales: [], profit: [], net: [] };
    g.n++; g.sales.push(r.sales_gross);
    if (r.operating_profit_estimated !== null) { g.profit.push(r.operating_profit_estimated); g.net.push(r.sales_net); }
    orgs.set(k, g);
  });
  const topOrgs = [...orgs.values()].map((g) => ({ ...g, total: sum(g.sales), gain: sum(g.profit), m: Number(sum(g.net)) > 0 ? dec(sum(g.profit)).div(sum(g.net)).mul(100).toFixed(1) : null }))
    .sort((a, b) => Number(b.total) - Number(a.total)).slice(0, 10);

  // Productos
  const prods = new Map<string, { name: string; qty: string[]; amount: string[]; orders: Set<string> }>();
  (items ?? []).forEach((i) => {
    const name = (i.products as unknown as { name: string } | null)?.name ?? String(i.description_original).split(/[.,]/)[0].slice(0, 60);
    const k = (i.product_id as string | null) ?? name.toUpperCase();
    const g = prods.get(k) ?? { name, qty: [], amount: [], orders: new Set() };
    g.qty.push(String(i.quantity)); g.amount.push(String(i.total_amount)); g.orders.add(i.purchase_order_id as string);
    prods.set(k, g);
  });
  const topProds = [...prods.values()].map((g) => ({ ...g, total: sum(g.amount), units: sum(g.qty) })).sort((a, b) => Number(b.total) - Number(a.total)).slice(0, 10);
  const maxProd = Number(topProds[0]?.total ?? 1) || 1;
  const dist = BUCKETS.map((b) => ({ label: b.label, n: withCost.filter((r) => b.test(Number(r.operating_margin_estimated))).length }));
  const maxDist = Math.max(1, ...dist.map((d) => d.n));

  return (
    <>
      <PageHeader title="Analítica" description="Ventas, márgenes, organismos y productos. Importes en ARS."
        actions={<div className="flex flex-wrap gap-1.5">{PERIODS.map(([k, l]) => (
          <Link key={k} href={`/analitica?p=${k}`} className={cn("rounded-full px-3 py-1.5 text-xs font-medium", p === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>{l}</Link>
        ))}</div>} />

      {!rows.length ? <Card><EmptyState icon={<TrendingUp />} title="Sin órdenes en el período" description="Importá órdenes para ver el análisis." /></Card> : (
        <div className="flex flex-col gap-5">
          <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat icon={Landmark} label="Adjudicado" value={formatMoney(sales)} sub={`${rows.length} órdenes`} />
            <Stat icon={TrendingUp} label="Ganancia estimada" value={formatMoney(profitSum)} sub={`${withCost.length} de ${rows.length} con costo`} tone={Number(profitSum) < 0 ? "danger" : "accent"} />
            <Stat icon={BadgePercent} label="Margen promedio" value={margin ? `${margin}%` : "—"} sub="Ponderado por venta" />
            <Stat icon={FileText} label="Ticket promedio" value={formatMoney(dec(sales).div(rows.length).toFixed(2))} sub="Por orden" />
          </div>

          <div className="grid gap-5 lg:grid-cols-2">
            <Card className="min-w-0">
              <CardHeader title="Adjudicado, facturado y cobrado" description="Últimos 12 meses" />
              <CardBody className="pt-2"><SeriesChart data={flows} series={[{ key: "awarded", label: "Adjudicado" }, { key: "invoiced", label: "Facturado" }, { key: "collected", label: "Cobrado" }]} /></CardBody>
            </Card>
            <Card className="min-w-0">
              <CardHeader title="Margen por mes" description="Ganancia estimada ÷ venta neta, órdenes con costo" />
              <CardBody className="pt-2"><SeriesChart data={marginSeries} series={[{ key: "margin", label: "Margen" }]} type="line" percent /></CardBody>
            </Card>
          </div>

          <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_minmax(0,1fr)_300px]">
            <Card className="min-w-0 overflow-hidden">
              <CardHeader title="Organismos" description="Por importe adjudicado" action={<Link href="/analitica/ranking" className="text-xs text-brand hover:underline">Ranking completo</Link>} />
              <ul className="divide-y divide-border">
                {topOrgs.map((o) => (
                  <li key={o.name} className="flex items-center gap-3 px-4 py-2.5 text-sm sm:px-5">
                    <span className="min-w-0 flex-1 truncate">{o.name}<span className="block text-xs text-fg-subtle">{o.n} orden{o.n === 1 ? "" : "es"}{o.m ? ` · margen ${o.m}%` : ""}</span></span>
                    <span className="shrink-0 font-medium tabular">{formatMoney(o.total)}</span>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="min-w-0 overflow-hidden">
              <CardHeader title="Productos más vendidos" description="Por importe adjudicado" />
              <ul className="divide-y divide-border">
                {topProds.map((g) => (
                  <li key={g.name} className="px-4 py-2.5 sm:px-5">
                    <div className="flex items-baseline justify-between gap-3 text-sm"><span className="truncate">{g.name}</span><span className="shrink-0 font-medium tabular">{formatMoney(g.total)}</span></div>
                    <div className="mt-1 h-1.5 rounded-full bg-surface-2"><div className="h-full rounded-full bg-brand" style={{ width: `${Math.max(3, (Number(g.total) / maxProd) * 100)}%` }} /></div>
                    <p className="mt-0.5 text-xs text-fg-subtle">{formatQty(g.units)} u · {g.orders.size} orden{g.orders.size === 1 ? "" : "es"}</p>
                  </li>
                ))}
              </ul>
            </Card>
            <Card className="self-start">
              <CardHeader title="Distribución de márgenes" description="Cantidad de órdenes" />
              <CardBody className="flex flex-col gap-2.5">
                {dist.map((d, i) => (
                  <div key={d.label} className="flex items-center gap-3 text-sm">
                    <span className="w-14 shrink-0 text-xs text-fg-muted">{d.label}</span>
                    <div className="h-5 flex-1 rounded-md bg-surface-2"><div className={cn("h-full rounded-md", i === 0 ? "bg-danger" : i === 1 ? "bg-warn" : "bg-brand")} style={{ width: `${(d.n / maxDist) * 100}%` }} /></div>
                    <span className="w-6 text-right tabular">{d.n}</span>
                  </div>
                ))}
              </CardBody>
            </Card>
          </div>
        </div>
      )}
    </>
  );
}
