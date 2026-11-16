import type { Metadata } from "next";
import Link from "next/link";
import { MapPinned, ScanLine, Truck } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Button } from "@/components/ui/button";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { DELIVERY_STATUS_LABEL, DELIVERY_TONE, deliveryNumber, type DeliveryStatus } from "@/lib/delivery";
import { formatDate, todayISO } from "@/lib/format";
import { BoardList, NewItemButton, type BoardItem } from "./hoja-de-ruta/board-ui";

export const metadata: Metadata = { title: "Entregas" };

export default async function DeliveriesPage() {
  const s = await requireOrg();
  const today = todayISO();
  const edit = canWrite(s.org.role) || s.org.role === "logistica";
  const [{ data: deliveries }, { data: summary }, { data: orders }, { data: board }, { data: bPend }, { data: bDone }] = await Promise.all([
    s.supabase.from("deliveries").select("id, internal_number, status, planned_date, actual_date, remito_number, purchase_order_id, delivery_items(quantity)")
      .eq("org_id", s.org.org_id).order("created_at", { ascending: false }).limit(200),
    s.supabase.from("po_delivery_summary").select("purchase_order_id, due_date, delivered_pct, next_planned_date, is_late").eq("org_id", s.org.org_id),
    s.supabase.from("purchase_orders_overview").select("id, bac_number, display_number, customer_name, status").eq("org_id", s.org.org_id).not("status", "in", "(anulada,cerrada,borrador)"),
    s.supabase.from("delivery_board").select("oc_refs, status, delivered_on, note").eq("org_id", s.org.org_id).neq("oc_refs", "{}").order("delivered_on", { ascending: false, nullsFirst: true }).limit(2000),
    s.supabase.from("delivery_board_overview").select("*").eq("org_id", s.org.org_id).eq("status", "pendiente").order("position").order("created_at").limit(500),
    s.supabase.from("delivery_board_overview").select("*").eq("org_id", s.org.org_id).eq("status", "entregado").order("delivered_on", { ascending: false }).limit(40),
  ]);
  // Lo cargado en la hoja de ruta para cada OC (pendiente o ya entregado)
  type BoardRow = { oc_refs: string[]; status: string; delivered_on: string | null; note: string | null };
  const boardOf = new Map<string, BoardRow[]>();
  for (const b of (board ?? []) as BoardRow[]) for (const r of b.oc_refs) boardOf.set(r, [...(boardOf.get(r) ?? []), b]);
  const po = new Map((orders ?? []).map((o) => [o.id, o]));
  const sum = new Map((summary ?? []).map((x) => [x.purchase_order_id, x]));
  const late = (summary ?? []).filter((x) => x.is_late && po.has(x.purchase_order_id));
  const pendingOrders = (orders ?? []).filter((o) => Number(sum.get(o.id)?.delivered_pct ?? 0) < 100);
  const upcoming = (deliveries ?? []).filter((d) => ["programada", "en_preparacion", "despachada"].includes(d.status));
  const label = (id: string) => { const o = po.get(id); return o ? (o.bac_number ?? o.display_number) : "Orden"; };

  return (
    <>
      <PageHeader title="Entregas" description="Programadas, en curso y realizadas. Entrega física y conformidad administrativa se registran por separado."
        actions={<><Button asChild><Link href="/entregas/hoja-de-ruta"><MapPinned /> Hoja de ruta</Link></Button><Button asChild variant="secondary"><Link href="/entregas/remito"><ScanLine /> Leer remito</Link></Button></>} />
      <div className="mb-5 grid gap-5 lg:grid-cols-2">
        <Card className="self-start overflow-hidden">
          <div className="flex flex-wrap items-start justify-between gap-2 pr-4 sm:pr-5">
            <CardHeader title={`Hoja de ruta · pendientes (${(bPend ?? []).length})`} description="Lo que hay que llevar. Marcá «Entregado» con la fecha cuando lo lleves." />
            {edit && <div className="pt-4"><NewItemButton /></div>}
          </div>
          <BoardList items={(bPend ?? []) as BoardItem[]} canEdit={edit} empty="No hay entregas pendientes." />
        </Card>
        <Card className="self-start overflow-hidden">
          <div className="flex items-start justify-between gap-2 pr-4 sm:pr-5">
            <CardHeader title="Hoja de ruta · últimos entregados" description="Los 40 más recientes" />
            <Button asChild size="sm" variant="secondary" className="mt-4"><Link href="/entregas/hoja-de-ruta">Ver todos por mes</Link></Button>
          </div>
          <BoardList items={(bDone ?? []) as BoardItem[]} canEdit={edit} empty="Todavía no hay entregados." />
        </Card>
      </div>
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
                  <span className="min-w-0 flex-1">
                    <span className="block truncate"><span className="font-medium">{o.bac_number ?? o.display_number}</span> <span className="text-fg-subtle">· {o.customer_name}</span></span>
                    {(() => {
                      const bs = boardOf.get((o.bac_number ?? "").toUpperCase()) ?? [];
                      const p = bs.find((b) => b.status === "pendiente"), d = bs.find((b) => b.status === "entregado");
                      if (p) return <span className="block truncate text-xs text-warn">Hoja de ruta · pendiente: {p.note ?? "sin detalle"}</span>;
                      if (d) return <span className="block truncate text-xs text-accent">Hoja de ruta · entregado {formatDate(d.delivered_on)}{d.note ? `: ${d.note}` : ""} (falta registrarlo en la OC)</span>;
                      return <span className="block text-xs text-fg-subtle">No está en la hoja de ruta</span>;
                    })()}
                  </span>
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
