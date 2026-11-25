import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { monthLabel } from "@/lib/months";
import { mlPage, ITEM_COLS, type ItemRow } from "@/lib/ml/page";
import { recentSales } from "@/lib/ml/sync";
import { cn } from "@/lib/utils";
import { Bars, NotConnected, int, pct } from "../pro-shared";

export const metadata: Metadata = { title: "Mercado Libre · Reportes" };
export const dynamic = "force-dynamic";

type Period = { key: string; amount: number; unpaid_amount: number; period: { date_from: string; date_to: string }; period_status: string };
type Detail = { charge_info: { transaction_detail: string; detail_amount: number; detail_type: string }; discount_info?: { discount_amount?: number } };
const VIEWS = [["ventas", "Ventas"], ["cargos", "Lo que te cobra ML"]] as const;
const DOW = ["Dom", "Lun", "Mar", "Mié", "Jue", "Vie", "Sáb"];

export default async function MlReports({ searchParams }: { searchParams: Promise<{ v?: string; p?: string }> }) {
  const sp = await searchParams;
  const v = sp.v ?? "ventas";
  const { sb, org, ml } = await mlPage();
  if (!ml) return (<><PageHeader title="Reportes" /><NotConnected /></>);
  const tabs = (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {VIEWS.map(([k, l]) => <Link key={k} href={`/mercadolibre/reportes?v=${k}`} className={cn("rounded-full px-3 py-1 text-xs font-semibold", v === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>{l}</Link>)}
    </div>
  );

  if (v === "cargos") {
    const periods = await ml.get<{ results: Period[] }>(`/billing/integration/monthly/periods?group=ML&document_type=BILL&limit=6`);
    const list = periods.ok ? periods.data.results ?? [] : [];
    const key = list.find((p) => p.key === sp.p)?.key ?? list.find((p) => p.period_status === "CLOSED")?.key ?? list[0]?.key;
    const details: Detail[] = [];
    if (key) for (let offset = 0; offset < 2000; offset += 150) {
      const r = await ml.get<{ results: Detail[]; total: number }>(`/billing/integration/periods/key/${key}/group/ML/details?document_type=BILL&limit=150&offset=${offset}`);
      if (!r.ok) break;
      details.push(...(r.data.results ?? []));
      if ((r.data.results ?? []).length < 150 || details.length >= r.data.total) break;
    }
    const by = new Map<string, { amount: number; n: number; discount: number }>();
    for (const d of details) {
      const k = d.charge_info.transaction_detail.trim() || d.charge_info.detail_type;
      const sign = d.charge_info.detail_type === "CHARGE" ? 1 : -1;
      const x = by.get(k) ?? { amount: 0, n: 0, discount: 0 };
      x.amount += sign * d.charge_info.detail_amount; x.n++; x.discount += d.discount_info?.discount_amount ?? 0;
      by.set(k, x);
    }
    const rows = [...by.entries()].sort((a, b) => b[1].amount - a[1].amount);
    const sel = list.find((p) => p.key === key);
    return (
      <>
        <PageHeader title="Reportes" description="Facturación de Mercado Libre: comisiones, envíos, publicidad y otros cargos, por período." />
        {tabs}
        <div className="mb-4 grid gap-3 sm:grid-cols-3 lg:grid-cols-6">
          {list.map((p) => (
            <Link key={p.key} href={`/mercadolibre/reportes?v=cargos&p=${p.key}`} className={cn("rounded-xl border px-3 py-2", p.key === key ? "border-brand bg-field" : "border-border hover:border-brand")}>
              <p className="text-xs text-fg-subtle">{p.period.date_from.slice(5).split("-").reverse().join("/")} → {p.period.date_to.slice(5).split("-").reverse().join("/")}</p>
              <p className="font-semibold tabular">{formatMoney(p.amount)}</p>
              {p.period_status === "OPEN" ? <Badge tone="info">En curso</Badge> : p.unpaid_amount > 0 ? <Badge tone="danger">Debés {formatMoney(p.unpaid_amount)}</Badge> : <Badge tone="accent">Pagado</Badge>}
            </Link>
          ))}
        </div>
        <Card>
          <CardHeader title={sel ? `Detalle ${sel.period.date_from} a ${sel.period.date_to}` : "Detalle"} description={`${details.length} movimientos.`} />
          {!periods.ok ? <CardBody className="text-sm text-danger">No se pudo leer la facturación ({periods.error}).</CardBody> : (
            <>
              <CardBody><Bars data={rows.slice(0, 10).map(([k, x]) => ({ label: k.slice(0, 22), value: Math.max(0, x.amount) }))} format={(n) => formatMoney(n)} /></CardBody>
              <table className="w-full text-sm">
                <thead className="text-left text-xs text-fg-subtle"><tr className="border-y border-border"><th className="px-5 py-2">Concepto</th><th className="px-3 text-right">Movimientos</th><th className="px-3 text-right">Descuentos</th><th className="px-5 text-right">Total</th></tr></thead>
                <tbody>{rows.map(([k, x]) => (
                  <tr key={k} className="border-b border-border last:border-0"><td className="px-5 py-2">{k}</td><td className="px-3 text-right tabular">{x.n}</td><td className="px-3 text-right tabular text-accent">{x.discount ? formatMoney(x.discount) : ""}</td><td className="px-5 text-right font-medium tabular">{formatMoney(x.amount)}</td></tr>
                ))}</tbody>
              </table>
            </>
          )}
        </Card>
      </>
    );
  }

  const [orders, itemsQ] = await Promise.all([recentSales(ml, 186), sb.from("ml_items").select(ITEM_COLS).eq("org_id", org)]);
  const items = (itemsQ.data ?? []) as unknown as ItemRow[];
  const cost = new Map(items.map((i) => [i.item_id, i.cost_unit]));
  const ar = (iso: string) => new Date(Date.parse(iso) - 3 * 3600e3);
  const months = new Map<string, { sales: number; orders: number; units: number; fees: number; cancelled: number; profit: number; noCost: boolean }>();
  const products = new Map<string, { title: string; sales: number; units: number }>();
  const dow = Array(7).fill(0) as number[], hour = Array(24).fill(0) as number[];
  const inst = new Map<string, number>();
  for (const o of orders) {
    const d = ar(o.date_created), ym = d.toISOString().slice(0, 7);
    const m = months.get(ym) ?? { sales: 0, orders: 0, units: 0, fees: 0, cancelled: 0, profit: 0, noCost: false };
    if (o.status === "cancelled") { m.cancelled++; months.set(ym, m); continue; }
    m.sales += Number(o.total_amount); m.orders++;
    for (const it of o.order_items) {
      m.units += it.quantity; m.fees += Number(it.sale_fee ?? 0) * it.quantity;
      const c = cost.get(it.item.id);
      if (c === null || c === undefined) m.noCost = true; else m.profit += (it.unit_price - Number(it.sale_fee ?? 0) - c) * it.quantity;
      const p = products.get(it.item.id) ?? { title: it.item.title, sales: 0, units: 0 };
      p.sales += it.unit_price * it.quantity; p.units += it.quantity; products.set(it.item.id, p);
    }
    dow[d.getUTCDay()]++; hour[d.getUTCHours()]++;
    const n = o.payments?.[0]?.installments ?? 1;
    const k = n <= 1 ? "1 pago" : n <= 3 ? "2-3 cuotas" : n <= 6 ? "4-6 cuotas" : "7+ cuotas";
    inst.set(k, (inst.get(k) ?? 0) + 1);
  }
  const ms = [...months.entries()].sort((a, b) => a[0].localeCompare(b[0]));
  const top = [...products.entries()].sort((a, b) => b[1].sales - a[1].sales).slice(0, 12);
  const totalOrders = ms.reduce((a, [, x]) => a + x.orders, 0);

  return (
    <>
      <PageHeader title="Reportes" description="Últimos 6 meses de ventas en Mercado Libre: evolución, productos, días y horarios, cuotas." />
      {tabs}
      <Card>
        <CardHeader title="Mes a mes" />
        <div className="overflow-x-auto">
          <table className="w-full min-w-[760px] text-sm">
            <thead className="text-left text-xs text-fg-subtle"><tr className="border-y border-border"><th className="px-5 py-2">Mes</th><th className="px-3 text-right">Ventas</th><th className="px-3 text-right">Órdenes</th><th className="px-3 text-right">Unidades</th><th className="px-3 text-right">Ticket</th><th className="px-3 text-right">Comisiones</th><th className="px-3 text-right">Canceladas</th><th className="px-5 text-right">Ganancia aprox.</th></tr></thead>
            <tbody>
              {ms.map(([ym, x], i) => {
                const prev = ms[i - 1]?.[1];
                const delta = prev && prev.sales ? ((x.sales - prev.sales) / prev.sales) * 100 : null;
                return (
                  <tr key={ym} className="border-b border-border last:border-0">
                    <td className="px-5 py-2 capitalize">{monthLabel(ym)}</td>
                    <td className="px-3 text-right tabular">{formatMoney(x.sales)} {delta !== null && <span className={cn("text-xs", delta >= 0 ? "text-accent" : "text-danger")}>{delta >= 0 ? "+" : ""}{delta.toFixed(0)} %</span>}</td>
                    <td className="px-3 text-right tabular">{x.orders}</td><td className="px-3 text-right tabular">{x.units}</td>
                    <td className="px-3 text-right tabular">{formatMoney(x.orders ? x.sales / x.orders : 0)}</td>
                    <td className="px-3 text-right tabular">{formatMoney(x.fees)}</td>
                    <td className="px-3 text-right tabular">{x.cancelled ? `${x.cancelled} (${pct((x.cancelled / (x.orders + x.cancelled)) * 100, 0)})` : "—"}</td>
                    <td className="px-5 text-right tabular">{formatMoney(x.profit)}{x.noCost && <span className="text-xs text-warn"> *</span>}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        <CardBody className="border-t border-border text-xs text-fg-subtle">* Falta el costo de algunas publicaciones (cargalo en Precios). La ganancia no descuenta envíos ni impuestos.</CardBody>
      </Card>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Productos que más facturan" />
          <CardBody><Bars data={top.map(([, p]) => ({ label: p.title.slice(0, 20), value: p.sales }))} format={(n) => formatMoney(n)} /></CardBody>
          <ul className="divide-y divide-border border-t border-border text-sm">
            {top.map(([id, p]) => <li key={id} className="flex justify-between gap-2 px-5 py-1.5"><Link href={`/mercadolibre/publicaciones/${id}`} className="truncate hover:underline">{p.title}</Link><span className="shrink-0 tabular text-fg-subtle">{int(p.units)} u.</span></li>)}
          </ul>
        </Card>
        <div className="space-y-5">
          <Card>
            <CardHeader title="¿Qué días se vende más?" />
            <CardBody><Bars data={dow.map((n, i) => ({ label: DOW[i], value: n }))} format={(n) => `${n} ventas`} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="¿A qué hora?" description="Útil para programar promos y responder preguntas." />
            <CardBody>
              <div className="flex h-24 items-end gap-0.5">
                {hour.map((n, h) => <div key={h} title={`${h} hs: ${n}`} className="flex-1 rounded-t bg-brand" style={{ height: `${(n / Math.max(...hour, 1)) * 100}%`, minHeight: 2 }} />)}
              </div>
              <div className="mt-1 flex justify-between text-[10px] text-fg-subtle"><span>0 hs</span><span>6</span><span>12</span><span>18</span><span>23</span></div>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Cuotas que eligen" />
            <CardBody><Bars data={["1 pago", "2-3 cuotas", "4-6 cuotas", "7+ cuotas"].map((k) => ({ label: k, value: inst.get(k) ?? 0 }))} format={(n) => pct(totalOrders ? (n / totalOrders) * 100 : 0, 0)} /></CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
