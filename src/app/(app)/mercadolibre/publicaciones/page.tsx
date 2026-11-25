import type { Metadata } from "next";
import Link from "next/link";
import { Copy, ExternalLink } from "lucide-react";
import { Badge, Card, Input, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { mlPage, ITEM_COLS, ITEM_STATUS, LISTING_TYPE, type ItemRow } from "@/lib/ml/page";
import { conversion, daysOfStock, duplicates, netPerUnit } from "@/lib/ml/logic";
import { cn } from "@/lib/utils";
import { BulkBar, CostInput, ItemQuickEdit, MlSyncNowButton } from "../pro-ui";
import { HealthBadge, NotConnected, int, pct } from "../pro-shared";

export const metadata: Metadata = { title: "Mercado Libre · Publicaciones" };
export const dynamic = "force-dynamic";

const FILTERS = [
  ["todas", "Todas"], ["activas", "Activas"], ["pausadas", "Pausadas"], ["problemas", "Con problemas"], ["quiebre", "Se quedan sin stock"],
  ["sin_stock", "Sin stock"], ["sin_costo", "Sin costo cargado"], ["sin_ventas", "Sin ventas en 30 días"], ["perdiendo", "Perdiendo catálogo"], ["duplicadas", "Parecidas entre sí"],
] as const;
const SORTS = [["ventas", "Más vendidas"], ["visitas", "Más visitas"], ["conversion", "Mejor conversión"], ["salud", "Peor calidad"], ["margen", "Menor margen"], ["stock", "Menos días de stock"]] as const;

export default async function MlListings({ searchParams }: { searchParams: Promise<{ f?: string; q?: string; o?: string }> }) {
  const sp = await searchParams;
  const f = sp.f ?? "todas", q = (sp.q ?? "").trim().toLowerCase(), o = sp.o ?? "ventas";
  const { sb, org, ml, edit } = await mlPage();
  if (!ml) return (<><PageHeader title="Publicaciones" /><NotConnected /></>);
  const { data } = await sb.from("ml_items").select(ITEM_COLS).eq("org_id", org);
  const all = ((data ?? []) as unknown as ItemRow[]).filter((i) => i.status !== "closed");

  const dupIds = new Set(duplicates(all.map((i) => ({ id: i.item_id, title: i.title, status: i.status ?? "" }))).flatMap((d) => [d.a, d.b]));
  const rows = all.map((i) => {
    const n = i.price ? netPerUnit({ price: i.price, fee: i.fee_unit, ship: i.ship_cost, cost: i.cost_unit }) : null;
    const h = i.health === null ? null : i.health <= 1 ? i.health * 100 : i.health;
    return { i, n, h, conv: conversion(i.sold_30d ?? 0, i.visits_30d ?? 0), dos: daysOfStock(i.available ?? 0, i.sold_30d ?? 0) };
  });
  const pass = (r: (typeof rows)[number]) => passFor(f, r, dupIds);
  const key = (r: (typeof rows)[number]): number => ({
    ventas: -(r.i.sold_30d ?? 0), visitas: -(r.i.visits_30d ?? 0), conversion: -(r.conv ?? -1), salud: r.h ?? 999, margen: r.n?.margin ?? 999, stock: r.dos ?? 99999,
  } as Record<string, number>)[o] ?? 0;
  const list = rows.filter(pass).filter((r) => !q || r.i.title.toLowerCase().includes(q) || r.i.item_id.toLowerCase().includes(q)).sort((a, b) => key(a) - key(b));
  const count = (k: string) => rows.filter((r) => passFor(k, r, dupIds)).length;
  const href = (p: Record<string, string>) => `/mercadolibre/publicaciones?${new URLSearchParams({ f, o, ...(q ? { q } : {}), ...p })}`;

  return (
    <>
      <PageHeader title="Publicaciones" description="Precio, stock, calidad, visitas, conversión y lo que te queda por venta. Editás acá y se cambia en Mercado Libre."
        actions={<div className="flex gap-2"><MlSyncNowButton /><Button asChild size="sm"><Link href="/mercadolibre/publicar">Nueva publicación</Link></Button></div>} />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {FILTERS.map(([k, label]) => (
          <Link key={k} href={href({ f: k })} className={cn("rounded-full px-3 py-1 text-xs font-semibold", f === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>{label} · {count(k)}</Link>
        ))}
      </div>
      <Card>
        <form className="flex flex-wrap items-center gap-2 border-b border-border px-5 py-3" action="/mercadolibre/publicaciones">
          <input type="hidden" name="f" value={f} />
          <Input name="q" defaultValue={sp.q ?? ""} placeholder="Buscar por título o MLA…" className="h-9 max-w-xs" />
          <select name="o" defaultValue={o} className="h-9 rounded-lg border border-card-border bg-field px-2 text-sm">{SORTS.map(([k, l]) => <option key={k} value={k}>{l}</option>)}</select>
          <Button size="sm" variant="secondary" type="submit">Ver</Button>
        </form>
        {edit && <BulkBar formId="ml-items" />}
        <div id="ml-items" className="overflow-x-auto">
          <table className="w-full min-w-[1100px] text-sm">
            <thead className="text-left text-xs text-fg-subtle">
              <tr className="border-b border-border">
                {edit && <th className="w-8 px-3 py-2" />}
                <th className="px-3 py-2">Publicación</th><th className="px-3 py-2">Precio · stock</th>
                <th className="px-3 py-2 text-right">Ventas 30d</th><th className="px-3 py-2 text-right">Visitas 30d</th><th className="px-3 py-2 text-right">Conv.</th>
                <th className="px-3 py-2 text-center">Calidad</th><th className="px-3 py-2">Costo</th><th className="px-3 py-2 text-right">Te queda / u.</th><th className="px-3 py-2 text-right">Stock para</th>
              </tr>
            </thead>
            <tbody>
              {list.map(({ i, n, h, conv, dos }) => {
                const st = ITEM_STATUS[i.status ?? ""] ?? { label: i.status ?? "—", tone: "neutral" as const };
                return (
                  <tr key={i.item_id} className="border-b border-border align-top last:border-0">
                    {edit && <td className="px-3 py-3"><input type="checkbox" name="sel" value={i.item_id} aria-label={`Elegir ${i.title}`} /></td>}
                    <td className="px-3 py-3">
                      <div className="flex gap-3">
                        {i.thumbnail && <img src={i.thumbnail} alt="" className="size-12 shrink-0 rounded-lg border border-border object-contain bg-white" />}
                        <div className="min-w-0">
                          <Link href={`/mercadolibre/publicaciones/${i.item_id}`} className="line-clamp-2 font-medium hover:underline">{i.title}</Link>
                          <div className="mt-1 flex flex-wrap items-center gap-1.5 text-xs text-fg-subtle">
                            <Badge tone={st.tone}>{st.label}</Badge>
                            <span>{i.item_id}</span><span>· {LISTING_TYPE[i.listing_type ?? ""] ?? i.listing_type}</span>
                            {i.catalog_listing && <Badge tone={i.competition === "winning" ? "accent" : "warn"}>Catálogo {i.competition === "winning" ? "ganando" : i.price_to_win ? `· gana a ${formatMoney(i.price_to_win)}` : ""}</Badge>}
                            {i.logistic === "fulfillment" && <Badge tone="info">Full</Badge>}
                            {(i.sub_status ?? []).map((s) => <Badge key={s} tone="danger">{s}</Badge>)}
                            {i.permalink && <a href={i.permalink} target="_blank" rel="noreferrer" aria-label="Ver en ML" className="hover:text-fg"><ExternalLink className="size-3.5" /></a>}
                            <Link href={`/mercadolibre/publicar?copiar=${i.item_id}`} aria-label="Duplicar" className="hover:text-fg"><Copy className="size-3.5" /></Link>
                          </div>
                        </div>
                      </div>
                    </td>
                    <td className="px-3 py-3">{edit ? <ItemQuickEdit id={i.item_id} price={i.price} stock={i.available} status={i.status} canEdit={edit} /> : <span className="tabular">{formatMoney(i.price)} · {i.available}</span>}</td>
                    <td className="px-3 py-3 text-right tabular">{int(i.sold_30d)}</td>
                    <td className="px-3 py-3 text-right tabular">{int(i.visits_30d)}</td>
                    <td className="px-3 py-3 text-right tabular">{pct(conv, 2)}</td>
                    <td className="px-3 py-3 text-center"><HealthBadge value={h} /></td>
                    <td className="px-3 py-3"><CostInput id={i.item_id} cost={i.cost_unit} canEdit={edit} /></td>
                    <td className="px-3 py-3 text-right tabular">
                      {n?.net !== null && n?.net !== undefined ? <><span className={n.net < 0 ? "text-danger" : ""}>{formatMoney(n.net)}</span><span className="block text-xs text-fg-subtle">{pct(n.margin)}</span></> : <span className="text-xs text-fg-subtle">{n ? `${formatMoney(n.beforeCost)} sin costo` : "—"}</span>}
                    </td>
                    <td className="px-3 py-3 text-right tabular">{dos === null ? <span className="text-fg-subtle">—</span> : <Badge tone={dos <= 3 ? "danger" : dos <= 10 ? "warn" : "neutral"}>{dos} días</Badge>}</td>
                  </tr>
                );
              })}
              {list.length === 0 && <tr><td colSpan={10} className="px-5 py-10 text-center text-sm text-fg-muted">{all.length ? "No hay publicaciones con ese filtro." : "Todavía no se sincronizaron las publicaciones: tocá Actualizar ahora."}</td></tr>}
            </tbody>
          </table>
        </div>
        <p className="border-t border-border px-5 py-3 text-xs text-fg-subtle">“Te queda / u.” = precio sin IVA − comisión − envío gratis que pagás − costo (sin IVA). El margen es sobre el precio sin IVA. No incluye Ingresos Brutos.</p>
      </Card>
    </>
  );
}

function passFor(k: string, r: { i: ItemRow; h: number | null; dos: number | null }, dupIds: Set<string>) {
  switch (k) {
    case "activas": return r.i.status === "active";
    case "pausadas": return r.i.status === "paused";
    case "problemas": return (r.h !== null && r.h < 70) || (r.i.sub_status?.length ?? 0) > 0 || r.i.status === "under_review";
    case "quiebre": return r.dos !== null && r.dos <= 10 && r.i.status === "active";
    case "sin_stock": return (r.i.available ?? 0) === 0;
    case "sin_costo": return r.i.cost_unit === null;
    case "sin_ventas": return (r.i.sold_30d ?? 0) === 0;
    case "perdiendo": return r.i.catalog_listing && r.i.competition !== "winning";
    case "duplicadas": return dupIds.has(r.i.item_id);
    default: return true;
  }
}
