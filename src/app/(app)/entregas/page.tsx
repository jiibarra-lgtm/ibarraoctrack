import type { Metadata } from "next";
import Link from "next/link";
import { ScanLine, Truck } from "lucide-react";
import { requireOrg } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { DELIVERY_STATUS_LABEL, DELIVERY_TONE, deliveryNumber, type DeliveryStatus } from "@/lib/delivery";
import { formatDate, todayISO } from "@/lib/format";

export const metadata: Metadata = { title: "Entregas" };

export default async function DeliveriesPage() {
  const s = await requireOrg();
  const today = todayISO();
  const [{ data: deliveries }, { data: summary }, { data: orders }] = await Promise.all([
    s.supabase.from("deliveries").select("id, internal_number, status, planned_date, actual_date, remito_number, purchase_order_id, delivery_items(quantity)")
      .eq("org_id", s.org.org_id).order("created_at", { ascending: false }).limit(200),
    s.supabase.from("po_delivery_summary").select("purchase_order_id, due_date, delivered_pct, next_planned_date, is_late").eq("org_id", s.org.org_id),
    s.supabase.from("purchase_orders_overview").select("id, bac_number, display_number, customer_name, status").eq("org_id", s.org.org_id).not("status", "in", "(anulada,cerrada,borrador)"),
  ]);
  const po = new Map((orders ?? []).map((o) => [o.id, o]));
  const sum = new Map((summary ?? []).map((x) => [x.purchase_order_id, x]));
  const late = (summary ?? []).filter((x) => x.is_late && po.has(x.purchase_order_id));
  const pendingOrders = (orders ?? []).filter((o) => Number(sum.get(o.id)?.delivered_pct ?? 0) < 100);
  const upcoming = (deliveries ?? []).filter((d) => ["programada", "en_preparacion", "despachada"].includes(d.status));
  const label = (id: string) => { const o = po.get(id); return o ? (o.bac_number ?? o.display_number) : "Orden"; };

  return (
    <>
      <PageHeader title="Entregas" description="Programadas, en curso y realizadas. Entrega física y conformidad administrativa se registran por separado."
        actions={<Button asChild variant="secondary"><Link href="/entregas/remito"><ScanLine /> Leer remito</Link></Button>} />
      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title={`Atrasadas (${late.length})`} description="Fecha límite vencida y con renglones pendientes" />
          {!late.length ? <p className="px-5 py-6 text-sm text-fg-subtle">Ninguna orden atrasada.</p> : (
            <ul className="divide-y divide-border">{late.map((x) => (
              <li key={x.purchase_order_id}><Link href={`/ordenes/${x.purchase_order_id}?tab=entregas`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-2/60 sm:px-5">
                <span className="min-w-0 truncate"><span className="font-medium">{label(x.purchase_order_id)}</span> <span className="text-fg-subtle">· {po.get(x.purchase_order_id)?.customer_name}</span></span>
                <span className="shrink-0 text-xs text-danger">vencía {formatDate(x.due_date)} · {Number(x.delivered_pct).toFixed(0)}%</span>
              </Link></li>
            ))}</ul>
          )}
        </Card>
        <Card>
          <CardHeader title={`Próximas (${upcoming.length})`} />
          {!upcoming.length ? <p className="px-5 py-6 text-sm text-fg-subtle">No hay entregas programadas.</p> : (
            <ul className="divide-y divide-border">{upcoming.map((d) => (
              <li key={d.id}><Link href={`/ordenes/${d.purchase_order_id}?tab=entregas`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-2/60 sm:px-5">
                <span className="min-w-0 truncate"><span className="font-medium">{deliveryNumber(d.internal_number)}</span> · {label(d.purchase_order_id)}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs">
                  <span className={d.planned_date && d.planned_date < today ? "text-danger" : "text-fg-subtle"}>{formatDate(d.planned_date)}</span>
                  <Badge tone={DELIVERY_TONE[d.status as DeliveryStatus]}>{DELIVERY_STATUS_LABEL[d.status as DeliveryStatus]}</Badge>
                </span>
              </Link></li>
            ))}</ul>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title={`Órdenes con entregas pendientes (${pendingOrders.length})`} />
          {!pendingOrders.length ? <EmptyState icon={<Truck />} title="Todo entregado" /> : (
            <ul className="divide-y divide-border">{pendingOrders.map((o) => {
              const x = sum.get(o.id); const pct = Number(x?.delivered_pct ?? 0);
              return (
                <li key={o.id}><Link href={`/ordenes/${o.id}?tab=entregas`} className="flex items-center gap-4 px-4 py-3 text-sm hover:bg-surface-2/60 sm:px-5">
                  <span className="min-w-0 flex-1 truncate"><span className="font-medium">{o.bac_number ?? o.display_number}</span> <span className="text-fg-subtle">· {o.customer_name}</span></span>
                  <span className="hidden text-xs text-fg-subtle sm:block">{x?.due_date ? `límite ${formatDate(x.due_date)}` : ""}</span>
                  <div className="flex w-36 items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-surface-2"><div className="h-full bg-accent" style={{ width: `${pct}%` }} /></div><span className="w-9 text-right text-xs tabular">{pct.toFixed(0)}%</span></div>
                </Link></li>
              );
            })}</ul>
          )}
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Últimas entregas" />
          {!deliveries?.length ? <p className="px-5 py-6 text-sm text-fg-subtle">Todavía no hay entregas.</p> : (
            <ul className="divide-y divide-border">{deliveries.slice(0, 30).map((d) => (
              <li key={d.id}><Link href={`/ordenes/${d.purchase_order_id}?tab=entregas`} className="flex items-center justify-between gap-3 px-4 py-3 text-sm hover:bg-surface-2/60 sm:px-5">
                <span className="min-w-0 truncate"><span className="font-medium">{deliveryNumber(d.internal_number)}</span> · {label(d.purchase_order_id)}{d.remito_number ? ` · remito ${d.remito_number}` : ""}</span>
                <span className="flex shrink-0 items-center gap-2 text-xs text-fg-subtle">{formatDate(d.actual_date ?? d.planned_date)}<Badge tone={DELIVERY_TONE[d.status as DeliveryStatus]}>{DELIVERY_STATUS_LABEL[d.status as DeliveryStatus]}</Badge></span>
              </Link></li>
            ))}</ul>
          )}
        </Card>
      </div>
    </>
  );
}
