import type { Metadata } from "next";
import Link from "next/link";
import { BellRing, CalendarClock, Download, PackageMinus, TrendingDown, TrendingUp } from "lucide-react";
import { Button } from "@/components/ui/button";
import { advise } from "@/lib/price-advice";
import { requireOrg } from "@/lib/session";
import { Badge, Card, CardHeader, EmptyState, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatDate, formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";

export const metadata: Metadata = { title: "Precios y stock" };

type Win = { id: string; contract_number: string; kind: "precios" | "stock"; starts_on: string; ends_on: string; contract_name: string | null; open_sent_at: string | null; closing_sent_at: string | null };
type Conv = { contract_number: string; name: string | null; process_number: string | null };
type Line = { id: string; contract_number: string; line_number: number; option_number: number; product_name: string; my_current_price: string | null; my_stock_balance: string | null;
  my_stock: string | null; best_other_price: string | null; cost: string | null };

const SHORT: Record<string, string> = { "623-20-CM26": "Limpieza", "623-26-CM26": "Contenedores", "623-38-CM26": "Tocador y perfumería", "623-43-CM26": "Bazar", "623-36-CM26": "Bazar (Lotería)" };
const todayAr = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const daysAgo = (n: number) => new Date(Date.now() - n * 864e5).toISOString().slice(0, 10);
const diff = (a: string, b: string) => Math.round((Date.parse(a) - Date.parse(b)) / 864e5);

export default async function PreciosStockPage() {
  const s = await requireOrg();
  const org = s.org.org_id;
  const today = todayAr();
  const [{ data: wData }, { data: cData }, { data: lData }, { data: oData }] = await Promise.all([
    s.supabase.from("convenio_windows").select("id, contract_number, kind, starts_on, ends_on, contract_name, open_sent_at, closing_sent_at").eq("org_id", org).gte("ends_on", daysAgo(400)).order("starts_on", { ascending: false }),
    s.supabase.from("convenios").select("contract_number, name, process_number").eq("org_id", org),
    s.supabase.from("convenio_lines").select("id, contract_number, line_number, option_number, product_name, my_current_price, my_stock_balance, my_stock, best_other_price, cost").eq("org_id", org).eq("is_mine", true).limit(3000),
    s.supabase.from("purchase_order_items").select("convenio_line_id, purchase_orders!inner(created_at, status)").eq("org_id", org).not("convenio_line_id", "is", null).limit(5000),
  ]);
  const wins = (wData ?? []) as Win[];
  const convs = (cData ?? []) as Conv[];
  const lines = (lData ?? []) as Line[];
  const label = (k: string, n?: string | null) => SHORT[k] ?? n ?? k;
  const contracts = [...new Set([...convs.map((c) => c.contract_number), ...wins.map((w) => w.contract_number)])].sort();
  const openNow = wins.filter((w) => w.starts_on <= today && w.ends_on >= today);
  const closingSoon = openNow.filter((w) => diff(w.ends_on, today) <= 1);

  // Stock: renglones tuyos con poco saldo (menos del 20% de lo ofertado o menos de 10 unidades)
  const lowStock = lines.filter((l) => l.my_stock_balance !== null && l.my_stock !== null && Number(l.my_stock) > 0
    && (Number(l.my_stock_balance) <= Number(l.my_stock) * 0.2 || Number(l.my_stock_balance) < 10))
    .sort((a, b) => Number(a.my_stock_balance) / Number(a.my_stock) - Number(b.my_stock_balance) / Number(b.my_stock));
  // Precio: renglones donde otro proveedor está más barato que vos
  const adv = lines.map(advise);
  const beaten = adv.filter((a) => a.status === "te_ganan").sort((a, b) => (b.beatPct ?? 0) - (a.beatPct ?? 0));
  const canRaise = adv.filter((a) => a.status === "ganas" && (a.move ?? 0) > 0).sort((a, b) => (b.move ?? 0) / (b.price ?? 1) - (a.move ?? 0) / (a.price ?? 1));

  // 53) Renglones que ganaste y nadie te pidió en 60 días
  const lastOrder = new Map<string, string>();
  for (const r of (oData ?? []) as unknown as { convenio_line_id: string; purchase_orders: { created_at: string; status: string } | { created_at: string; status: string }[] }[]) {
    const po = Array.isArray(r.purchase_orders) ? r.purchase_orders[0] : r.purchase_orders;
    if (!po || po.status === "anulada") continue;
    if ((lastOrder.get(r.convenio_line_id) ?? "") < po.created_at) lastOrder.set(r.convenio_line_id, po.created_at);
  }
  const cutoff = daysAgo(60);
  const idle = lines.filter((l) => (lastOrder.get(l.id) ?? "").slice(0, 10) < cutoff)
    .sort((a, b) => (lastOrder.get(b.id) ?? "").localeCompare(lastOrder.get(a.id) ?? "") || a.line_number - b.line_number);

  return (
    <>
      <PageHeader title="Precios y stock" description="Plazos de actualización de precios e incremento de stock de tus convenios marco, leídos de los avisos del BAC, y qué renglones conviene tocar."
        actions={<Button asChild><a href="/api/precios/export" download><Download /> Exportar a Excel</a></Button>} />

      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={CalendarClock} label="Abiertas ahora" value={String(openNow.filter((w) => w.kind === "precios").length)} sub={openNow.length ? openNow.filter((w) => w.kind === "precios").map((w) => label(w.contract_number, w.contract_name)).join(", ") || "solo stock" : "ninguna ventana abierta"} tone={openNow.length ? "warn" : undefined} />
        <Stat icon={BellRing} label="Cierran hoy o mañana" value={String(closingSoon.length)} sub={closingSoon.map((w) => `${label(w.contract_number)} (${w.kind})`).join(", ") || "—"} tone={closingSoon.length ? "danger" : undefined} />
        <Stat icon={PackageMinus} label="Renglones con poco stock" value={String(lowStock.length)} sub="menos del 20% de lo ofertado" tone={lowStock.length ? "warn" : undefined} />
        <Stat icon={TrendingDown} label="Te ganan en precio" value={String(beaten.length)} sub={`${beaten.filter((a) => a.canLower).length} te da para bajar · ${canRaise.length} podés subir`} />
      </div>

      {!contracts.length ? (
        <Card><EmptyState icon={<CalendarClock />} title="Todavía no hay plazos" description="Cuando llegue el mail 'Inicio período de actualización de precios' de un convenio, aparece acá con sus fechas." /></Card>
      ) : (
        <div className="mb-5 grid gap-4 md:grid-cols-2">
          {contracts.map((k) => {
            const ws = wins.filter((w) => w.contract_number === k);
            const conv = convs.find((c) => c.contract_number === k);
            const name = label(k, conv?.name ?? ws[0]?.contract_name);
            const block = (kind: "precios" | "stock") => {
              const list = ws.filter((w) => w.kind === kind);
              const cur = list.find((w) => w.starts_on <= today && w.ends_on >= today);
              const next = list.filter((w) => w.starts_on > today).sort((a, b) => a.starts_on.localeCompare(b.starts_on))[0];
              const last = list.filter((w) => w.ends_on < today)[0];
              return (
                <div className="rounded-xl border border-border px-3 py-2.5">
                  <p className="text-xs font-medium uppercase tracking-wide text-fg-subtle">{kind === "precios" ? "Actualización de precios" : "Incremento de stock"}</p>
                  {cur ? (
                    <p className="mt-1 text-sm"><Badge tone={diff(cur.ends_on, today) <= 1 ? "danger" : "warn"}>Abierta</Badge> hasta el <b>{formatDate(cur.ends_on)}</b>
                      <span className="text-fg-subtle"> · {diff(cur.ends_on, today) === 0 ? "cierra hoy" : `quedan ${diff(cur.ends_on, today)} días`}</span></p>
                  ) : next ? (
                    <p className="mt-1 text-sm">Próxima: <b>{formatDate(next.starts_on)}</b> al {formatDate(next.ends_on)} <span className="text-fg-subtle">· en {diff(next.starts_on, today)} días</span></p>
                  ) : (
                    <p className="mt-1 text-sm text-fg-muted">Cerrada{last ? ` · la última fue del ${formatDate(last.starts_on)} al ${formatDate(last.ends_on)}` : " · sin avisos todavía"}</p>
                  )}
                </div>
              );
            };
            const mine = lines.filter((l) => l.contract_number === k);
            return (
              <Card key={k} className="overflow-hidden">
                <CardHeader title={name} description={`${k}${conv?.process_number ? ` · proceso ${conv.process_number}` : ""} · ${mine.length} renglones tuyos`}
                  action={<Link href={`/productos?c=${k}`} className="text-xs underline">Ver renglones</Link>} />
                <div className="grid gap-2 px-5 pb-4 sm:grid-cols-2">{block("precios")}{block("stock")}</div>
                {ws.length > 0 && (
                  <details className="border-t border-border px-5 py-2 text-xs text-fg-muted">
                    <summary className="cursor-pointer">Historial de plazos ({ws.length})</summary>
                    <ul className="mt-2 space-y-1">
                      {ws.map((w) => (
                        <li key={w.id} className="flex justify-between gap-2">
                          <span>{w.kind === "precios" ? "Precios" : "Stock"}: {formatDate(w.starts_on)} → {formatDate(w.ends_on)}</span>
                          <span className="text-fg-subtle">{w.open_sent_at ? "avisado" : w.ends_on < today ? "" : "aviso pendiente"}</span>
                        </li>
                      ))}
                    </ul>
                  </details>
                )}
              </Card>
            );
          })}
        </div>
      )}

      <div className="grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Renglones con poco stock" description="Saldo de stock que te queda en el convenio contra lo que ofertaste: pedí incremento en la próxima ventana" />
          <ul className="max-h-[480px] divide-y divide-border overflow-y-auto">
            {lowStock.map((l) => (
              <li key={`${l.contract_number}-${l.line_number}-${l.option_number}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <div className="min-w-0"><p className="truncate font-medium">R{l.line_number} · {l.product_name}</p><p className="text-xs text-fg-subtle">{label(l.contract_number)}</p></div>
                <div className="shrink-0 text-right tabular">
                  <p className={cn("font-semibold", Number(l.my_stock_balance) <= 0 ? "text-danger" : "text-warn")}>{Number(l.my_stock_balance).toLocaleString("es-AR")}</p>
                  <p className="text-[11px] text-fg-subtle">de {Number(l.my_stock).toLocaleString("es-AR")} · pedí +{advise(l).stockAdd?.toLocaleString("es-AR")}</p>
                </div>
              </li>
            ))}
            {!lowStock.length && <li className="px-5 py-4 text-sm text-fg-subtle">Todos tus renglones tienen stock de sobra.</li>}
          </ul>
        </Card>
        <Card className="overflow-hidden">
          <CardHeader title="Te ganan en precio" description="Tu precio actual contra el más barato de los demás proveedores del renglón (con IVA)" />
          <ul className="max-h-[480px] divide-y divide-border overflow-y-auto">
            {beaten.map((a) => (
              <li key={`${a.contract_number}-${a.line_number}-${a.option_number}`} className="grid gap-1.5 px-5 py-3 text-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0"><p className="truncate font-medium">R{a.line_number} · {a.product_name}</p><p className="text-xs text-fg-subtle">{label(a.contract_number)}</p></div>
                  <div className="shrink-0 text-right tabular">
                    <p><span className="font-semibold">{formatMoney(a.price)}</span> <span className="text-xs text-fg-subtle">vs {formatMoney(a.best)}</span></p>
                    <p className="text-[11px] text-warn">te ganan por {formatMoney(a.beatBy)} ({a.beatPct!.toFixed(1)}%)</p>
                  </div>
                </div>
                <p className={cn("rounded-lg px-2.5 py-1.5 text-xs", a.canLower === false ? "bg-danger/10 text-danger" : a.canLower ? "bg-accent/10 text-accent" : "bg-field text-fg-muted")}>
                  {a.canLower === false ? `No te da: para ganar tendrías que ir a ${formatMoney(a.target)} y tu mínimo es ${formatMoney(a.minPrice)}.`
                    : `Bajá ${formatMoney(-(a.move ?? 0))} → ${formatMoney(a.target)}${a.marginTarget !== null ? ` · ganás ${a.marginTarget.toFixed(0)}%` : " · cargá tu costo en Productos para ver si te da"}`}
                </p>
              </li>
            ))}
            {!beaten.length && <li className="px-5 py-4 text-sm text-fg-subtle">Sos el más barato en todos tus renglones.</li>}
          </ul>
        </Card>
        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader title={`Podés subirle (${canRaise.length})`} description="Sos el más barato con margen: subiendo hasta 1% abajo del siguiente seguís ganando" />
          <ul className="max-h-[480px] divide-y divide-border overflow-y-auto">
            {canRaise.map((a) => (
              <li key={`${a.contract_number}-${a.line_number}-${a.option_number}`} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <div className="min-w-0"><p className="truncate font-medium">R{a.line_number} · {a.product_name}</p><p className="text-xs text-fg-subtle">{label(a.contract_number)} · el siguiente está a {formatMoney(a.best)}</p></div>
                <div className="shrink-0 text-right tabular">
                  <p className="font-semibold text-accent"><TrendingUp className="mr-1 inline size-3.5" />+{formatMoney(a.move)} → {formatMoney(a.target)}</p>
                  <p className="text-[11px] text-fg-subtle">hoy {formatMoney(a.price)}{a.marginTarget !== null ? ` · ganarías ${a.marginTarget.toFixed(0)}%` : ""}</p>
                </div>
              </li>
            ))}
            {!canRaise.length && <li className="px-5 py-4 text-sm text-fg-subtle">No hay renglones donde puedas subir sin perder el primer lugar.</li>}
          </ul>
        </Card>
        <Card className="overflow-hidden xl:col-span-2">
          <CardHeader title={`Nadie te los pidió en 60 días (${idle.length})`} description="Renglones del convenio que son tuyos pero ningún organismo te compró en los últimos 60 días: revisá precio, stock o si conviene dejarlos" />
          <ul className="max-h-[420px] divide-y divide-border overflow-y-auto">
            {idle.slice(0, 200).map((l) => {
              const last = lastOrder.get(l.id);
              const beat = l.best_other_price && l.my_current_price && Number(l.best_other_price) < Number(l.my_current_price);
              return (
                <li key={l.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <div className="min-w-0"><p className="truncate font-medium">R{l.line_number} · {l.product_name}</p><p className="text-xs text-fg-subtle">{label(l.contract_number)}{beat ? " · otro proveedor está más barato" : ""}</p></div>
                  <p className="shrink-0 text-right text-xs text-fg-muted">{last ? `último pedido ${formatDate(last)}` : "nunca lo pidieron"}</p>
                </li>
              );
            })}
            {!idle.length && <li className="px-5 py-4 text-sm text-fg-subtle">Todos tus renglones tuvieron pedidos en los últimos 60 días.</li>}
          </ul>
        </Card>
      </div>
    </>
  );
}
