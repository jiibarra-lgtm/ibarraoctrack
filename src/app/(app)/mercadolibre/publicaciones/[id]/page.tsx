import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { Copy, ExternalLink } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { formatDateTime, formatMoney } from "@/lib/format";
import { mlPage, ITEM_COLS, ITEM_STATUS, LISTING_TYPE, type ItemRow } from "@/lib/ml/page";
import type { ApiItem } from "@/lib/ml/client";
import { abWinner, buildTitle, conversion, daysOfStock, missingKeywords, netPerUnit, priceForMargin, quantityTiers, type AbResults } from "@/lib/ml/logic";
import { AbStopButtons, AbTestForm, CopyButton, CostInput, ItemQuickEdit, PriceRuleEditor, PromoButton } from "../../pro-ui";
import { HealthBadge, NotConnected, Spark, ago, int, pct } from "../../pro-shared";

export const metadata: Metadata = { title: "Mercado Libre · Publicación" };
export const dynamic = "force-dynamic";

type Promo = { id: string; type: string; name?: string; status: string; price?: number; suggested_discounted_price?: number; min_discounted_price?: number; max_discounted_price?: number; finish_date?: string };

export default async function MlItem({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!/^MLA\d+$/.test(id)) notFound();
  const { sb, org, ml, edit } = await mlPage();
  if (!ml) return (<><PageHeader title="Publicación" /><NotConnected /></>);

  const [rowQ, dailyQ, histQ, ruleQ, abQ, compQ, itemR, descR, promosR] = await Promise.all([
    sb.from("ml_items").select(ITEM_COLS).eq("org_id", org).eq("item_id", id).maybeSingle(),
    sb.from("ml_item_daily").select("day, visits, sold_total, price, available").eq("org_id", org).eq("item_id", id).order("day").limit(90),
    sb.from("ml_item_history").select("at, field, old_value, new_value, source").eq("org_id", org).eq("item_id", id).order("at", { ascending: false }).limit(30),
    sb.from("ml_price_rules").select("*").eq("org_id", org).eq("item_id", id).maybeSingle(),
    sb.from("ml_ab_tests").select("*").eq("org_id", org).eq("item_id", id).order("started_at", { ascending: false }).limit(5),
    sb.from("ml_competitors").select("id, kind, ref, label, last, checked_at").eq("org_id", org).eq("my_item_id", id),
    ml.get<ApiItem>(`/items/${id}`),
    ml.get<{ plain_text: string }>(`/items/${id}/description`),
    ml.get<Promo[]>(`/seller-promotions/items/${id}?app_version=v2`),
  ]);
  if (!itemR.ok) notFound();
  const it = itemR.data;
  if (it.seller_id && it.seller_id !== ml.userId) notFound();
  const row = rowQ.data as unknown as ItemRow | null;
  const trendsR = await ml.get<{ keyword: string }[]>(`/trends/MLA/${it.category_id}`);
  const trends = trendsR.ok ? trendsR.data.map((t) => t.keyword) : [];
  const missing = missingKeywords(it.title, trends, 10);

  const fee = row?.fee_unit ?? null, ship = row?.ship_cost ?? null, cost = row?.cost_unit ?? null;
  const n = netPerUnit({ price: it.price, fee, ship, cost });
  const feePct = fee && it.price ? (fee / it.price) * 100 : 14;
  const daily = dailyQ.data ?? [];
  const soldPerDay = daily.map((d, i) => (i === 0 || d.sold_total === null || daily[i - 1].sold_total === null ? 0 : Math.max(0, d.sold_total - daily[i - 1].sold_total!)));
  const h = row?.health === null || row?.health === undefined ? null : row.health <= 1 ? row.health * 100 : row.health;
  const st = ITEM_STATUS[it.status] ?? { label: it.status, tone: "neutral" as const };
  const promos = promosR.ok && Array.isArray(promosR.data) ? promosR.data : [];
  const ab = abQ.data ?? [];
  const running = ab.find((t) => t.status === "running");
  const pics = it.pictures ?? [];
  const attrsEmpty = (it.attributes ?? []).filter((a) => !a.value_name).length;
  const desc = descR.ok ? descR.data.plain_text : "";

  // chequeo rápido tipo "auditoría" (como Real Trends / Nubimetrics)
  const checks = [
    { ok: it.title.length >= 45, label: `Título de ${it.title.length} caracteres`, tip: "Usá entre 45 y 60: producto + marca + modelo + atributos clave." },
    { ok: pics.length >= 6, label: `${pics.length} fotos`, tip: "Subí al menos 6, con fondo blanco la primera." },
    { ok: !!it.video_id, label: it.video_id ? "Tiene video" : "Sin video", tip: "Los clips suben la conversión." },
    { ok: desc.length >= 300, label: `Descripción de ${desc.length} caracteres`, tip: "Explicá usos, medidas, qué incluye, garantía y factura." },
    { ok: attrsEmpty === 0, label: attrsEmpty ? `${attrsEmpty} atributos sin completar` : "Atributos completos", tip: "Los filtros de búsqueda usan los atributos." },
    { ok: !!it.shipping?.free_shipping || it.price < 33000, label: it.shipping?.free_shipping ? "Envío gratis" : "Sin envío gratis", tip: "Desde el mínimo de ML, el envío gratis suma mucho en el ranking." },
    { ok: (it.sale_terms ?? []).some((s) => s.id === "WARRANTY_TYPE"), label: "Garantía", tip: "Indicá la garantía en Condiciones de venta." },
    { ok: missing.length < 3, label: missing.length ? `Faltan ${missing.length} palabras buscadas` : "Incluye las palabras buscadas", tip: missing.slice(0, 5).join(", ") },
  ];
  const tiers = quantityTiers(10);

  return (
    <>
      <PageHeader breadcrumb={<Link href="/mercadolibre/publicaciones" className="hover:underline">Publicaciones</Link>} title={it.title}
        description={`${it.id} · ${LISTING_TYPE[it.listing_type_id] ?? it.listing_type_id} · creada ${it.date_created ? formatDateTime(it.date_created) : "—"}`}
        actions={<div className="flex gap-2">
          <Button asChild size="sm" variant="secondary"><a href={it.permalink} target="_blank" rel="noreferrer"><ExternalLink /> Ver en ML</a></Button>
          <Button asChild size="sm" variant="secondary"><Link href={`/mercadolibre/publicar?copiar=${it.id}`}><Copy /> Duplicar</Link></Button>
        </div>} />

      <div className="grid gap-5 lg:grid-cols-[1.3fr_1fr]">
        <Card>
          <CardBody className="flex flex-wrap gap-5">
            {pics[0] && <img src={pics[0].secure_url} alt="" className="size-40 rounded-xl border border-border bg-white object-contain" />}
            <div className="min-w-0 flex-1 space-y-3 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <Badge tone={st.tone}>{st.label}</Badge>
                {(it.sub_status ?? []).map((s) => <Badge key={s} tone="danger">{s}</Badge>)}
                {it.catalog_listing && <Badge tone={row?.competition === "winning" ? "accent" : "warn"}>Catálogo: {row?.competition === "winning" ? "ganando" : row?.competition ?? "—"}</Badge>}
                <span className="text-fg-subtle">Calidad</span> <HealthBadge value={h} />
              </div>
              <ItemQuickEdit id={it.id} price={it.price} stock={it.available_quantity} status={it.status} canEdit={edit} />
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <Mini label="Vendidas (total)" v={int(it.sold_quantity)} />
                <Mini label="Ventas 30 días" v={int(row?.sold_30d)} />
                <Mini label="Visitas 30 días" v={int(row?.visits_30d)} />
                <Mini label="Conversión" v={pct(conversion(row?.sold_30d ?? 0, row?.visits_30d ?? 0), 2)} />
              </div>
              {daily.length > 1 && (
                <div className="flex items-end gap-6">
                  <div><p className="text-xs text-fg-subtle">Visitas por día</p><Spark values={daily.map((d) => d.visits ?? 0)} /></div>
                  <div><p className="text-xs text-fg-subtle">Ventas por día</p><Spark values={soldPerDay} className="text-accent" /></div>
                </div>
              )}
              {row?.sold_30d ? <p className="text-xs text-fg-subtle">Stock para {daysOfStock(it.available_quantity, row.sold_30d) ?? "—"} días al ritmo actual.</p> : null}
            </div>
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Cuánto te queda por venta" description="Con la comisión y el envío reales de esta publicación." />
          <CardBody className="space-y-1.5 text-sm">
            <Line l="Precio" v={formatMoney(it.price)} />
            <Line l="Sin IVA" v={formatMoney(n.priceNet)} muted />
            <Line l={`Comisión ML (${pct(feePct)})`} v={`− ${formatMoney(n.fee)}`} />
            <Line l="Envío gratis que pagás" v={`− ${formatMoney(n.ship)}`} />
            <div className="flex items-center justify-between gap-2"><span>Costo del producto (sin IVA)</span><CostInput id={it.id} cost={cost} canEdit={edit} /></div>
            <div className="my-2 border-t border-border" />
            <Line l="Te queda" v={n.net !== null ? formatMoney(n.net) : `${formatMoney(n.beforeCost)} antes del costo`} strong />
            {n.margin !== null && <Line l="Margen" v={pct(n.margin)} />}
            {cost !== null && (
              <p className="pt-2 text-xs text-fg-subtle">
                Precio para ganar 15 %: <b>{formatMoney(priceForMargin(cost, 15, feePct, ship ?? 0))}</b> · 25 %: <b>{formatMoney(priceForMargin(cost, 25, feePct, ship ?? 0))}</b> · 35 %: <b>{formatMoney(priceForMargin(cost, 35, feePct, ship ?? 0))}</b>
              </p>
            )}
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Auditoría de la publicación" description="Lo que te pide Mercado Libre y lo que suma para vender más." />
          <ul className="divide-y divide-border text-sm">
            {(row?.warnings ?? []).map((w) => (
              <li key={w.title} className="flex items-center justify-between gap-2 px-5 py-2">
                <span><Badge tone="danger">ML</Badge> {w.title}</span>
                {w.link && <a href={w.link} target="_blank" rel="noreferrer" className="text-xs underline">Resolver</a>}
              </li>
            ))}
            {checks.map((c) => (
              <li key={c.label} className="px-5 py-2">
                <span className={c.ok ? "text-accent" : "text-warn"}>{c.ok ? "✓" : "•"}</span> {c.label}
                {!c.ok && <span className="block pl-4 text-xs text-fg-subtle">{c.tip}</span>}
              </li>
            ))}
          </ul>
        </Card>

        <Card>
          <CardHeader title="Palabras clave" description="Lo más buscado en la categoría que tu título no tiene." />
          <CardBody className="space-y-3 text-sm">
            {missing.length ? (
              <>
                <div className="flex flex-wrap gap-1.5">{missing.map((w) => <Badge key={w} tone="info">{w}</Badge>)}</div>
                <div className="rounded-lg bg-field px-3 py-2">
                  <p className="text-xs text-fg-subtle">Título sugerido</p>
                  <p className="font-medium">{buildTitle(it.title, missing)}</p>
                </div>
                <CopyButton text={buildTitle(it.title, missing)} label="Copiar título" />
                <p className="text-xs text-fg-subtle">Si la publicación ya tiene ventas, ML no deja cambiar el título: probalo en una copia o con una prueba A/B en una nueva.</p>
              </>
            ) : <p className="text-fg-muted">{trends.length ? "Tu título ya incluye lo más buscado." : "ML no devolvió búsquedas para esta categoría."}</p>}
            <Link href={`/mercadolibre/palabras?cat=${it.category_id}`} className="text-xs underline">Ver todas las palabras de la categoría</Link>
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Precio automático" description="Se ajusta solo cada 10 minutos dentro del piso y techo que pongas (activalo en Automatizaciones)." />
          <CardBody>{edit ? <PriceRuleEditor itemId={it.id} price={it.price} rule={ruleQ.data ?? undefined} /> : <p className="text-sm text-fg-muted">Sin permiso para editar.</p>}</CardBody>
        </Card>

        <Card>
          <CardHeader title="Promociones disponibles" description="Las campañas de ML a las que te podés sumar con esta publicación." />
          {promos.length === 0 ? <CardBody className="text-sm text-fg-muted">No hay promociones disponibles ahora.</CardBody> : (
            <ul className="divide-y divide-border text-sm">
              {promos.map((p) => (
                <li key={`${p.type}-${p.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2">
                  <span>{p.name ?? p.type} <span className="text-xs text-fg-subtle">{p.status === "started" ? "· estás adentro" : ""}{p.suggested_discounted_price ? ` · sugerido ${formatMoney(p.suggested_discounted_price)}` : ""}{p.finish_date ? ` · hasta ${p.finish_date.slice(0, 10)}` : ""}</span></span>
                  {edit && <PromoButton itemId={it.id} promo={{ id: p.id, type: p.type, name: p.name ?? p.type }} joined={p.status === "started"} suggested={p.suggested_discounted_price ?? null} />}
                </li>
              ))}
            </ul>
          )}
          <CardBody className="border-t border-border text-xs text-fg-subtle">
            Precio por cantidad sugerido (mayorista, hasta 10 %): {tiers.map((t) => `${t.min}+ u. −${t.pct} % (${formatMoney(it.price * (1 - t.pct / 100))})`).join(" · ")}
          </CardBody>
        </Card>
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="Prueba A/B" description="Alterna dos títulos o precios cada pocos días y te dice cuál vende más." />
          <CardBody className="space-y-3 text-sm">
            {running ? (
              <>
                <p>En curso: probando <b>{running.field === "title" ? "título" : "precio"}</b>, ahora está la <b>{running.current.toUpperCase()}</b>.</p>
                <AbTable r={running.results as AbResults} a={running.variant_a} b={running.variant_b} />
                {edit && <AbStopButtons id={running.id} />}
              </>
            ) : edit ? <AbTestForm itemId={it.id} title={it.title} price={it.price} /> : <p className="text-fg-muted">Sin pruebas.</p>}
            {ab.filter((t) => t.status !== "running").slice(0, 3).map((t) => (
              <p key={t.id} className="text-xs text-fg-subtle">{t.field === "title" ? "Título" : "Precio"} ({t.started_at.slice(0, 10)}): {abWinner(t.results as AbResults).reason}</p>
            ))}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Competencia de esta publicación" action={<Link href="/mercadolibre/mercado?v=competencia" className="text-xs underline">Agregar</Link>} />
          {(compQ.data ?? []).length === 0 ? <CardBody className="text-sm text-fg-muted">No seguís a nadie para esta publicación.</CardBody> : (
            <ul className="divide-y divide-border text-sm">
              {(compQ.data ?? []).map((c) => {
                const l = (c.last ?? {}) as { title?: string; price?: number; available?: number; sold?: number; permalink?: string };
                return (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-5 py-2">
                    <span className="min-w-0 truncate">{l.permalink ? <a href={l.permalink} target="_blank" rel="noreferrer" className="hover:underline">{l.title ?? c.ref}</a> : l.title ?? c.label ?? c.ref}</span>
                    <span className="shrink-0 tabular">{l.price ? formatMoney(l.price) : "—"} {l.price && it.price ? <Badge tone={l.price < it.price ? "danger" : "accent"}>{l.price < it.price ? "más barato" : "más caro"}</Badge> : null}</span>
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>

      <Card className="mt-5">
        <CardHeader title="Historial de cambios" description="Precio, título y estado (de la app y de Mercado Libre)." />
        {(histQ.data ?? []).length === 0 ? <CardBody className="text-sm text-fg-muted">Sin cambios registrados todavía.</CardBody> : (
          <ul className="divide-y divide-border text-sm">
            {(histQ.data ?? []).map((x, k) => (
              <li key={k} className="flex flex-wrap justify-between gap-2 px-5 py-2">
                <span><b>{x.field === "price" ? "Precio" : x.field === "title" ? "Título" : x.field === "status" ? "Estado" : x.field}</b>: {x.field === "price" ? `${formatMoney(x.old_value)} → ${formatMoney(x.new_value)}` : `${x.old_value} → ${x.new_value}`} <span className="text-xs text-fg-subtle">({x.source === "app" ? "desde la app" : x.source === "auto" ? "automático" : "en ML"})</span></span>
                <span className="text-xs text-fg-subtle">{ago(x.at)}</span>
              </li>
            ))}
          </ul>
        )}
      </Card>
    </>
  );
}

const Mini = ({ label, v }: { label: string; v: string }) => (<div className="rounded-xl border border-border px-3 py-2"><p className="text-lg font-semibold tabular">{v}</p><p className="text-xs text-fg-subtle">{label}</p></div>);
const Line = ({ l, v, muted, strong }: { l: string; v: string; muted?: boolean; strong?: boolean }) => (
  <div className={`flex justify-between gap-2 ${muted ? "text-xs text-fg-subtle" : ""} ${strong ? "text-base font-semibold" : ""}`}><span>{l}</span><span className="tabular">{v}</span></div>
);
function AbTable({ r, a, b }: { r: AbResults; a: string; b: string }) {
  const w = abWinner(r);
  return (
    <table className="w-full text-xs">
      <thead className="text-fg-subtle"><tr><th className="text-left">Variante</th><th className="text-right">Días</th><th className="text-right">Visitas</th><th className="text-right">Ventas</th></tr></thead>
      <tbody>
        {(["a", "b"] as const).map((k) => (
          <tr key={k} className={w.winner === k ? "font-semibold text-accent" : ""}><td className="max-w-[220px] truncate">{k.toUpperCase()}: {k === "a" ? a : b}</td><td className="text-right">{r[k].days}</td><td className="text-right">{r[k].visits}</td><td className="text-right">{r[k].sold}</td></tr>
        ))}
        <tr><td colSpan={4} className="pt-1 text-fg-subtle">{w.reason}</td></tr>
      </tbody>
    </table>
  );
}
