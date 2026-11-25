import type { Metadata } from "next";
import Link from "next/link";
import { ExternalLink } from "lucide-react";
import { Badge, Card, CardBody, CardHeader, Input, PageHeader } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { formatMoney } from "@/lib/format";
import { mlPage, LEVEL } from "@/lib/ml/page";
import { pool, type ApiItem } from "@/lib/ml/client";
import { norm, words } from "@/lib/ml/logic";
import { cn } from "@/lib/utils";
import { CompetitorForm, RemoveCompetitor } from "../pro-ui";
import { NotConnected, ago } from "../pro-shared";

export const metadata: Metadata = { title: "Mercado Libre · Mercado" };
export const dynamic = "force-dynamic";

const VIEWS = [["tendencias", "Más vendidos y tendencias"], ["oportunidades", "Oportunidades"], ["catalogo", "Buscar en catálogo"], ["competencia", "Competencia"]] as const;
type Product = { id: string; name: string; status?: string; buy_box_winner?: { price?: number; seller_id?: number; item_id?: string; shipping?: { free_shipping?: boolean } } | null; pictures?: { url: string }[]; permalink?: string };

export default async function MlMarket({ searchParams }: { searchParams: Promise<{ v?: string; cat?: string; q?: string }> }) {
  const sp = await searchParams;
  const v = sp.v ?? "tendencias";
  const { sb, org, ml, edit } = await mlPage();
  if (!ml) return (<><PageHeader title="Mercado" /><NotConnected /></>);
  const { data: mine } = await sb.from("ml_items").select("item_id, title, category_id, price, status").eq("org_id", org).neq("status", "closed");
  const myItems = mine ?? [];
  const myCats = [...new Set(myItems.map((i) => i.category_id).filter(Boolean))] as string[];
  const catNames = new Map<string, string>();
  await pool(myCats.slice(0, 20), 5, async (c) => { const r = await ml.get<{ name: string; path_from_root: { name: string }[] }>(`/categories/${c}`); if (r.ok) catNames.set(c, r.data.path_from_root.slice(-2).map((p) => p.name).join(" › ")); });
  const cat = sp.cat && /^MLA\d+$/.test(sp.cat) ? sp.cat : myCats[0];
  const tabs = (
    <div className="mb-3 flex flex-wrap gap-1.5">
      {VIEWS.map(([k, l]) => <Link key={k} href={`/mercadolibre/mercado?v=${k}${cat ? `&cat=${cat}` : ""}`} className={cn("rounded-full px-3 py-1 text-xs font-semibold", v === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>{l}</Link>)}
    </div>
  );
  const catPicker = (
    <div className="mb-4 flex flex-wrap gap-1.5">
      {myCats.map((c) => <Link key={c} href={`/mercadolibre/mercado?v=${v}&cat=${c}`} className={cn("rounded-lg border px-2.5 py-1 text-xs", c === cat ? "border-brand bg-brand text-brand-fg" : "border-border hover:border-brand")}>{catNames.get(c) ?? c}</Link>)}
    </div>
  );

  let body: React.ReactNode = null;
  if (v === "tendencias" && cat) {
    const [trends, hl] = await Promise.all([
      ml.get<{ keyword: string; url: string }[]>(`/trends/MLA/${cat}`),
      ml.get<{ content: { id: string; type: string; position: number }[] }>(`/highlights/MLA/category/${cat}`),
    ]);
    const top = (hl.ok ? hl.data.content ?? [] : []).slice(0, 20);
    const resolved = await pool(top, 5, async (h) => {
      if (h.type === "PRODUCT") { const p = await ml.get<Product>(`/products/${h.id}`); return p.ok ? { pos: h.position, title: p.data.name, price: p.data.buy_box_winner?.price ?? null, url: `https://www.mercadolibre.com.ar/p/${h.id}`, pic: p.data.pictures?.[0]?.url ?? null, id: h.id } : null; }
      const it = await ml.get<ApiItem>(`/items/${h.id}`); return it.ok ? { pos: h.position, title: it.data.title, price: it.data.price, url: it.data.permalink, pic: it.data.thumbnail, id: h.id, sold: it.data.sold_quantity } : null;
    });
    const mineSet = new Set(myItems.map((i) => i.item_id));
    body = (
      <div className="grid gap-5 lg:grid-cols-[1.5fr_1fr]">
        <Card>
          <CardHeader title="Los 20 más vendidos de la categoría" description="Ranking de Mercado Libre (se actualiza a diario)." />
          {resolved.filter(Boolean).length === 0 ? <CardBody className="text-sm text-fg-muted">ML no devolvió el ranking para esta categoría.</CardBody> : (
            <ul className="divide-y divide-border">
              {resolved.filter((x): x is NonNullable<typeof x> => !!x).map((x) => (
                <li key={x.id} className="flex items-center gap-3 px-5 py-2 text-sm">
                  <span className="w-6 text-right font-semibold tabular text-fg-subtle">{x.pos}</span>
                  {x.pic && <img src={x.pic.replace(/^http:/, "https:")} alt="" className="size-10 rounded border border-border bg-white object-contain" />}
                  <a href={x.url} target="_blank" rel="noreferrer" className="min-w-0 flex-1 truncate hover:underline">{x.title}</a>
                  {mineSet.has(x.id) && <Badge tone="accent">Tuya</Badge>}
                  <span className="shrink-0 tabular">{x.price ? formatMoney(x.price) : "—"}</span>
                </li>
              ))}
            </ul>
          )}
        </Card>
        <Card>
          <CardHeader title="Lo más buscado" description="Búsquedas que más crecen en la categoría." />
          <CardBody className="flex flex-wrap gap-1.5">
            {(trends.ok ? trends.data : []).map((t) => <a key={t.keyword} href={t.url} target="_blank" rel="noreferrer"><Badge tone="info">{t.keyword}</Badge></a>)}
          </CardBody>
          <CardBody className="border-t border-border"><Link href={`/mercadolibre/palabras?cat=${cat}`} className="text-xs underline">Analizar palabras clave de esta categoría</Link></CardBody>
        </Card>
      </div>
    );
  }

  if (v === "oportunidades") {
    // búsquedas en tendencia de mis categorías que ninguna de mis publicaciones cubre
    const myWords = new Set(myItems.flatMap((i) => words(i.title)));
    const all = await pool(myCats.slice(0, 12), 4, async (c) => {
      const t = await ml.get<{ keyword: string; url: string }[]>(`/trends/MLA/${c}`);
      return (t.ok ? t.data : []).map((x) => ({ ...x, cat: c, missing: words(x.keyword).filter((w) => !myWords.has(w)) }));
    });
    const opps = all.flat().filter((x) => x.missing.length > 0);
    const seen = new Set<string>();
    const unique = opps.filter((x) => { const k = norm(x.keyword); if (seen.has(k)) return false; seen.add(k); return true; });
    body = (
      <Card>
        <CardHeader title={`${unique.length} búsquedas que no estás cubriendo`} description="Gente buscando en tus categorías cosas que no tenés publicadas (o no con esas palabras). Posibles productos nuevos o títulos a mejorar." />
        <ul className="divide-y divide-border">
          {unique.slice(0, 80).map((x) => (
            <li key={`${x.cat}-${x.keyword}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-sm">
              <span><a href={x.url} target="_blank" rel="noreferrer" className="font-medium hover:underline">{x.keyword}</a> <span className="text-xs text-fg-subtle">· {catNames.get(x.cat) ?? x.cat}</span></span>
              <span className="flex items-center gap-1.5">{x.missing.map((w) => <Badge key={w} tone="warn">{w}</Badge>)}
                <Link href={`/mercadolibre/mercado?v=catalogo&q=${encodeURIComponent(x.keyword)}`} className="text-xs underline">ver productos</Link></span>
            </li>
          ))}
        </ul>
      </Card>
    );
  }

  if (v === "catalogo") {
    const q = (sp.q ?? "").trim();
    const res = q ? await ml.get<{ results: Product[] }>(`/products/search?status=active&site_id=MLA&q=${encodeURIComponent(q)}&limit=20`) : null;
    body = (
      <Card>
        <form action="/mercadolibre/mercado" className="flex gap-2 border-b border-border px-5 py-3">
          <input type="hidden" name="v" value="catalogo" />
          <Input name="q" defaultValue={q} placeholder="Buscá un producto (ej. resma A4 75 g)" className="h-9" />
          <Button size="sm" type="submit">Buscar</Button>
        </form>
        {!q ? <CardBody className="text-sm text-fg-muted">Buscá un producto para ver el precio ganador del catálogo, quién lo vende y si tiene envío gratis. Mercado Libre no deja buscar publicaciones comunes desde aplicaciones externas, solo el catálogo.</CardBody>
          : !res?.ok ? <CardBody className="text-sm text-danger">No se pudo buscar ({res?.error}).</CardBody>
          : (
            <ul className="divide-y divide-border">
              {(res.data.results ?? []).map((p) => (
                <li key={p.id} className="flex flex-wrap items-center gap-3 px-5 py-2 text-sm">
                  {p.pictures?.[0] && <img src={p.pictures[0].url} alt="" className="size-10 rounded border border-border bg-white object-contain" />}
                  <a href={`https://www.mercadolibre.com.ar/p/${p.id}`} target="_blank" rel="noreferrer" className="min-w-0 flex-1 hover:underline">{p.name} <ExternalLink className="inline size-3" /></a>
                  <span className="tabular">{p.buy_box_winner?.price ? formatMoney(p.buy_box_winner.price) : <span className="text-xs text-fg-subtle">sin ganador</span>}</span>
                  {p.buy_box_winner?.shipping?.free_shipping && <Badge tone="accent">Envío gratis</Badge>}
                </li>
              ))}
            </ul>
          )}
      </Card>
    );
  }

  if (v === "competencia") {
    const { data } = await sb.from("ml_competitors").select("*").eq("org_id", org).order("created_at", { ascending: false });
    const comps = data ?? [];
    const myPrice = new Map(myItems.map((i) => [i.item_id, i.price]));
    const myTitle = new Map(myItems.map((i) => [i.item_id, i.title]));
    const items = comps.filter((c) => c.kind === "item"), sellers = comps.filter((c) => c.kind === "seller");
    body = (
      <div className="space-y-5">
        {edit && <Card><CardHeader title="Seguir a un competidor" description="Te aviso cuando cambia el precio, se queda sin stock o pausa. Se revisa cada hora." /><CompetitorForm myItems={myItems.filter((i) => i.status === "active").map((i) => ({ id: i.item_id, title: i.title }))} /></Card>}
        <Card>
          <CardHeader title={`Publicaciones y productos seguidos · ${items.length}`} />
          {items.length === 0 ? <CardBody className="text-sm text-fg-muted">Todavía no seguís ninguna.</CardBody> : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[760px] text-sm">
                <thead className="text-left text-xs text-fg-subtle"><tr className="border-b border-border"><th className="px-5 py-2">Competidor</th><th className="px-3 text-right">Precio</th><th className="px-3 text-right">Antes</th><th className="px-3 text-right">Vendidos</th><th className="px-3">Contra la mía</th><th className="px-3">Revisado</th><th /></tr></thead>
                <tbody>
                  {items.map((c) => {
                    const l = (c.last ?? {}) as { title?: string; price?: number; prev_price?: number; sold?: number; prev_sold?: number; available?: number; status?: string; permalink?: string; free_shipping?: boolean; catalog?: boolean };
                    const mp = c.my_item_id ? myPrice.get(c.my_item_id) : null;
                    const diff = mp && l.price ? ((l.price - mp) / mp) * 100 : null;
                    return (
                      <tr key={c.id} className="border-b border-border last:border-0">
                        <td className="max-w-[300px] px-5 py-2">
                          <a href={l.permalink} target="_blank" rel="noreferrer" className="line-clamp-1 font-medium hover:underline">{l.title ?? c.label ?? c.ref}</a>
                          <span className="text-xs text-fg-subtle">{c.ref}{l.catalog ? " · catálogo" : ""}{l.free_shipping ? " · envío gratis" : ""}{l.available === 0 ? " · SIN STOCK" : ""}{l.status && l.status !== "active" && l.status !== "catalog" ? ` · ${l.status}` : ""}</span>
                        </td>
                        <td className="px-3 text-right tabular">{l.price ? formatMoney(l.price) : "—"}</td>
                        <td className="px-3 text-right tabular text-fg-subtle">{l.prev_price && l.prev_price !== l.price ? formatMoney(l.prev_price) : ""}</td>
                        <td className="px-3 text-right tabular">{l.sold ?? "—"}{l.prev_sold !== undefined && l.sold !== undefined && l.prev_sold !== null && l.sold - l.prev_sold > 0 ? <span className="text-xs text-accent"> +{l.sold - l.prev_sold}</span> : null}</td>
                        <td className="px-3 text-xs">{c.my_item_id ? <><Link href={`/mercadolibre/publicaciones/${c.my_item_id}`} className="line-clamp-1 hover:underline">{myTitle.get(c.my_item_id) ?? c.my_item_id}</Link>{diff !== null && <Badge tone={diff < 0 ? "danger" : "accent"}>{diff < 0 ? `${Math.abs(diff).toFixed(0)} % más barato` : `${diff.toFixed(0)} % más caro`}</Badge>}</> : "—"}</td>
                        <td className="px-3 text-xs text-fg-subtle">{ago(c.checked_at)}</td>
                        <td className="px-3">{edit && <RemoveCompetitor id={c.id} />}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </Card>
        <Card>
          <CardHeader title={`Vendedores seguidos · ${sellers.length}`} />
          {sellers.length === 0 ? <CardBody className="text-sm text-fg-muted">Marcá “seguir al vendedor” al pegar una publicación suya.</CardBody> : (
            <ul className="divide-y divide-border text-sm">
              {sellers.map((c) => {
                const l = (c.last ?? {}) as { nickname?: string; level?: string; power?: string; sales?: number; permalink?: string };
                return (
                  <li key={c.id} className="flex items-center justify-between gap-2 px-5 py-2">
                    <span><a href={l.permalink} target="_blank" rel="noreferrer" className="font-medium hover:underline">{l.nickname ?? c.ref}</a>
                      <span className="text-xs text-fg-subtle"> · {l.level ? LEVEL[l.level]?.label ?? l.level : "sin nivel"}{l.power ? ` · MercadoLíder ${l.power}` : ""} · {l.sales?.toLocaleString("es-AR") ?? "—"} ventas</span></span>
                    {edit && <RemoveCompetitor id={c.id} />}
                  </li>
                );
              })}
            </ul>
          )}
        </Card>
      </div>
    );
  }

  return (
    <>
      <PageHeader title="Mercado y competencia" description="Qué se vende y se busca en tus categorías, oportunidades, catálogo y seguimiento de la competencia." />
      {tabs}
      {(v === "tendencias") && catPicker}
      {!myCats.length && v === "tendencias" ? <Card><CardBody className="text-sm text-fg-muted">Sincronizá las publicaciones para ver tus categorías.</CardBody></Card> : body}
    </>
  );
}
