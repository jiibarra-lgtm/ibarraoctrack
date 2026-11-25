import type { Metadata } from "next";
import Link from "next/link";
import { Map as MapIcon, Printer } from "lucide-react";
import { Badge, Card, CardBody, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatMoney } from "@/lib/format";
import { mlPage } from "@/lib/ml/page";
import { pool, type ApiShipment } from "@/lib/ml/client";
import { recentSales } from "@/lib/ml/sync";
import { saleStage } from "@/lib/ml/logic";
import { cn } from "@/lib/utils";
import { InvoiceUpload, MessageForm, MlSyncNowButton } from "../pro-ui";
import { NotConnected } from "../pro-shared";

export const metadata: Metadata = { title: "Mercado Libre · Ventas" };
export const dynamic = "force-dynamic";

type Ship = ApiShipment & { receiver_address?: ApiShipment["receiver_address"] & { address_line?: string; comment?: string | null; receiver_name?: string } };
const VIEWS = [["hoy", "Para despachar"], ["demoradas", "Demoradas"], ["camino", "En camino"], ["todas", "Últimos 30 días"]] as const;
const LOGISTIC: Record<string, string> = { self_service: "Flex", cross_docking: "Colecta", drop_off: "Correo / punto", fulfillment: "Full", xd_drop_off: "Places" };

export default async function MlSales({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const v = (await searchParams).v ?? "hoy";
  const { ml, edit } = await mlPage();
  if (!ml) return (<><PageHeader title="Ventas" /><NotConnected /></>);
  const orders = await recentSales(ml, 30);

  // un envío por pack: se consultan sólo los que no están entregados ni cancelados (los demás se ven igual)
  const shipIds = [...new Set(orders.filter((o) => o.shipping?.id && o.status !== "cancelled").map((o) => o.shipping!.id!))];
  const ships = new Map<number, Ship>();
  await pool(shipIds.slice(0, 120), 6, async (id) => { const r = await ml.get<Ship>(`/shipments/${id}`); if (r.ok) ships.set(id, r.data); });

  // agrupar órdenes del mismo carrito (pack)
  const packs = new Map<string, typeof orders>();
  for (const o of orders) { const k = String(o.pack_id ?? o.id); packs.set(k, [...(packs.get(k) ?? []), o]); }
  const rows = [...packs.entries()].map(([pack, os]) => {
    const o = os[0];
    const sh = o.shipping?.id ? ships.get(o.shipping.id) ?? null : null;
    const limit = sh?.lead_time?.estimated_handling_limit?.date ?? null;
    const stage = saleStage({ status: o.status, shipStatus: sh?.status ?? null, shipSub: sh?.substatus ?? null, handlingLimit: limit });
    const total = os.reduce((a, x) => a + Number(x.total_amount), 0);
    const fee = os.reduce((a, x) => a + x.order_items.reduce((b, i) => b + Number(i.sale_fee ?? 0) * i.quantity, 0), 0);
    return { pack, os, o, sh, limit, stage, total, fee, invoiced: (o.tags ?? []).includes("invoice_uploaded") || os.some((x) => (x.tags ?? []).includes("invoice_uploaded")) };
  }).sort((a, b) => b.o.date_created.localeCompare(a.o.date_created));

  const toShip = rows.filter((r) => r.stage.key === "preparar" || r.stage.key === "despachar" || r.stage.key === "acordar");
  const late = rows.filter((r) => r.stage.tone === "danger");
  const onWay = rows.filter((r) => r.stage.key === "en_camino");
  const list = v === "hoy" ? toShip : v === "demoradas" ? late : v === "camino" ? onWay : rows;
  const labelIds = toShip.filter((r) => r.sh && r.sh.logistic_type !== "fulfillment" && r.sh.status === "ready_to_ship").map((r) => r.sh!.id);
  const flex = toShip.filter((r) => r.sh?.logistic_type === "self_service" && r.sh.receiver_address);
  const addr = (s: Ship) => [s.receiver_address?.address_line, s.receiver_address?.city?.name, s.receiver_address?.state?.name].filter(Boolean).join(", ");
  const route = flex.length ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(addr(flex.at(-1)!.sh!))}${flex.length > 1 ? `&waypoints=${encodeURIComponent(flex.slice(0, -1).map((r) => addr(r.sh!)).join("|"))}` : ""}&travelmode=driving` : null;
  const noInvoice = rows.filter((r) => r.o.status === "paid" && !r.invoiced).length;
  const count = { hoy: toShip.length, demoradas: late.length, camino: onWay.length, todas: rows.length } as Record<string, number>;

  return (
    <>
      <PageHeader title="Ventas" description="Lo que tenés que preparar hoy, etiquetas, demoras, facturas y mensajes al comprador." actions={<MlSyncNowButton />} />
      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <Card><CardBody><p className="text-2xl font-semibold tabular">{toShip.length}</p><p className="text-sm text-fg-muted">para preparar / despachar</p></CardBody></Card>
        <Card><CardBody><p className={cn("text-2xl font-semibold tabular", late.length && "text-danger")}>{late.length}</p><p className="text-sm text-fg-muted">demoradas (afectan la reputación)</p></CardBody></Card>
        <Card><CardBody><p className={cn("text-2xl font-semibold tabular", noInvoice && "text-warn")}>{noInvoice}</p><p className="text-sm text-fg-muted">ventas sin factura subida</p></CardBody></Card>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-1.5">
        {VIEWS.map(([k, l]) => <Link key={k} href={`/mercadolibre/ventas?v=${k}`} className={cn("rounded-full px-3 py-1 text-xs font-semibold", v === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>{l} · {count[k]}</Link>)}
        <span className="flex-1" />
        {labelIds.length > 0 && <Button asChild size="sm" variant="secondary"><a href={`/api/ml/etiquetas?ids=${labelIds.join(",")}`} target="_blank" rel="noreferrer"><Printer /> Imprimir {labelIds.length} etiquetas</a></Button>}
        {labelIds.length > 0 && <Button asChild size="sm" variant="ghost"><a href={`/api/ml/etiquetas?ids=${labelIds.join(",")}&formato=zpl`}>Zebra</a></Button>}
        {route && <Button asChild size="sm" variant="secondary"><a href={route} target="_blank" rel="noreferrer"><MapIcon /> Ruta Flex ({flex.length})</a></Button>}
      </div>

      <Card>
        {list.length === 0 ? <CardBody className="py-10 text-center text-sm text-fg-muted">{v === "hoy" ? "No hay nada para despachar. 🎉" : "Sin ventas en esta vista."}</CardBody> : (
          <ul className="divide-y divide-border">
            {list.map((r) => (
              <li key={r.pack} className="px-5 py-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    {r.os.flatMap((o) => o.order_items).map((i, k) => (
                      <p key={k} className="font-medium"><span className="tabular">{i.quantity} ×</span> <Link href={`/mercadolibre/publicaciones/${i.item.id}`} className="hover:underline">{i.item.title}</Link></p>
                    ))}
                    <p className="mt-0.5 text-xs text-fg-subtle">
                      #{r.pack} · {formatDateTime(r.o.date_created)} · {r.o.buyer?.nickname ?? "comprador"}
                      {r.sh?.logistic_type ? ` · ${LOGISTIC[r.sh.logistic_type] ?? r.sh.logistic_type}` : ""}
                      {r.sh?.receiver_address?.city?.name ? ` · ${r.sh.receiver_address.city.name}, ${r.sh.receiver_address.state?.name ?? ""}` : ""}
                    </p>
                    {r.limit && r.stage.key !== "entregada" && r.stage.key !== "en_camino" && <p className="text-xs text-fg-subtle">Despachar antes de: {formatDateTime(r.limit)}</p>}
                  </div>
                  <div className="text-right">
                    <p className="font-semibold tabular">{formatMoney(r.total)}</p>
                    <p className="text-xs text-fg-subtle">comisión {formatMoney(r.fee)}</p>
                    <Badge tone={r.stage.tone}>{r.stage.label}</Badge>
                  </div>
                </div>
                {edit && (
                  <div className="mt-2 flex flex-wrap items-center gap-1.5">
                    {r.invoiced ? <Badge tone="accent">Factura subida</Badge> : r.o.status === "paid" ? <InvoiceUpload pack={r.pack} /> : null}
                    {r.sh?.status === "ready_to_ship" && r.sh.logistic_type !== "fulfillment" && <Button asChild size="sm" variant="ghost"><a href={`/api/ml/etiquetas?ids=${r.sh.id}`} target="_blank" rel="noreferrer">Etiqueta</a></Button>}
                    {r.o.buyer?.id && <MessageForm pack={r.pack} buyer={String(r.o.buyer.id)} />}
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}
