import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { mlPage } from "@/lib/ml/page";
import { pool, type ApiItem } from "@/lib/ml/client";
import { buildTitle, missingKeywords, wordFreq, words } from "@/lib/ml/logic";
import { cn } from "@/lib/utils";
import { CopyButton } from "../pro-ui";
import { NotConnected } from "../pro-shared";
import { TitleBuilder } from "./title-builder";

export const metadata: Metadata = { title: "Mercado Libre · Palabras clave" };
export const dynamic = "force-dynamic";

export default async function MlKeywords({ searchParams }: { searchParams: Promise<{ cat?: string }> }) {
  const sp = await searchParams;
  const { sb, org, ml } = await mlPage();
  if (!ml) return (<><PageHeader title="Palabras clave" /><NotConnected /></>);
  const [{ data: mine }, { data: qs }] = await Promise.all([
    sb.from("ml_items").select("item_id, title, category_id, status, sold_30d, visits_30d").eq("org_id", org).neq("status", "closed"),
    sb.from("ml_questions").select("text, item_id").eq("org_id", org).limit(500),
  ]);
  const items = mine ?? [];
  const cats = [...new Set(items.map((i) => i.category_id).filter(Boolean))] as string[];
  const cat = sp.cat && /^MLA\d+$/.test(sp.cat) ? sp.cat : cats[0];
  const names = new Map<string, string>();
  await pool(cats.slice(0, 20), 5, async (c) => { const r = await ml.get<{ name: string }>(`/categories/${c}`); if (r.ok) names.set(c, r.data.name); });
  if (!cat) return (<><PageHeader title="Palabras clave" /><Card><CardBody className="text-sm text-fg-muted">Sincronizá tus publicaciones para analizar sus categorías.</CardBody></Card></>);

  const [trendsR, hlR] = await Promise.all([
    ml.get<{ keyword: string; url: string }[]>(`/trends/MLA/${cat}`),
    ml.get<{ content: { id: string; type: string }[] }>(`/highlights/MLA/category/${cat}`),
  ]);
  const trends = trendsR.ok ? trendsR.data.map((t) => t.keyword) : [];
  const top = (hlR.ok ? hlR.data.content ?? [] : []).slice(0, 20);
  const topTitles = (await pool(top, 5, async (h) => {
    if (h.type === "PRODUCT") { const p = await ml.get<{ name: string }>(`/products/${h.id}`); return p.ok ? p.data.name : null; }
    const it = await ml.get<ApiItem>(`/items/${h.id}`); return it.ok ? it.data.title : null;
  })).filter((x): x is string => !!x);

  const inCat = items.filter((i) => i.category_id === cat);
  const myWords = new Set(inCat.flatMap((i) => words(i.title)));
  const searchWords = wordFreq(trends, 30);
  const leaderWords = wordFreq(topTitles, 30);
  const askWords = wordFreq((qs ?? []).filter((q) => inCat.some((i) => i.item_id === q.item_id)).map((q) => q.text), 15);
  const gaps = leaderWords.filter((w) => !myWords.has(w.word) && w.n >= 3);

  return (
    <>
      <PageHeader title="Palabras clave" description="Qué busca la gente, qué palabras usan los que más venden y cuáles te faltan en los títulos (como Nubimetrics / Real Trends)." />
      <div className="mb-4 flex flex-wrap gap-1.5">
        {cats.map((c) => <Link key={c} href={`/mercadolibre/palabras?cat=${c}`} className={cn("rounded-lg border px-2.5 py-1 text-xs", c === cat ? "border-brand bg-brand text-brand-fg" : "border-border hover:border-brand")}>{names.get(c) ?? c} · {items.filter((i) => i.category_id === c).length}</Link>)}
      </div>

      <div className="grid gap-5 lg:grid-cols-3">
        <Card>
          <CardHeader title="Lo más buscado" description="Búsquedas en tendencia de la categoría." />
          <CardBody className="space-y-1 text-sm">
            {trends.length === 0 ? <p className="text-fg-muted">Sin datos de ML.</p> : trends.slice(0, 25).map((t, i) => (
              <p key={t} className="flex justify-between gap-2"><span><span className="tabular text-fg-subtle">{i + 1}.</span> {t}</span>{words(t).every((w) => myWords.has(w)) ? <Badge tone="accent">la cubrís</Badge> : null}</p>
            ))}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Palabras de los más vendidos" description={`En los títulos de los ${topTitles.length} más vendidos.`} />
          <CardBody className="flex flex-wrap gap-1.5">
            {leaderWords.map((w) => <Badge key={w.word} tone={myWords.has(w.word) ? "accent" : "warn"}>{w.word} · {w.n}</Badge>)}
          </CardBody>
          <CardBody className="border-t border-border text-xs text-fg-subtle">Verde: ya la usás. Naranja: la usan los líderes y vos no.</CardBody>
        </Card>
        <Card>
          <CardHeader title="Palabras de las búsquedas" />
          <CardBody className="flex flex-wrap gap-1.5">{searchWords.map((w) => <Badge key={w.word} tone={myWords.has(w.word) ? "accent" : "info"}>{w.word} · {w.n}</Badge>)}</CardBody>
          {askWords.length > 0 && (<>
            <CardHeader title="Lo que te preguntan" />
            <CardBody className="flex flex-wrap gap-1.5">{askWords.map((w) => <Badge key={w.word}>{w.word} · {w.n}</Badge>)}</CardBody>
          </>)}
        </Card>
      </div>

      {gaps.length > 0 && (
        <Card className="mt-5">
          <CardHeader title="Te faltan" description="Palabras que usan 3 o más de los líderes y ninguna de tus publicaciones de esta categoría." />
          <CardBody className="flex flex-wrap gap-1.5">{gaps.map((w) => <Badge key={w.word} tone="warn">{w.word}</Badge>)}</CardBody>
        </Card>
      )}

      <Card className="mt-5">
        <CardHeader title="Tus títulos en esta categoría" description="Título sugerido con las palabras buscadas que faltan (máx. 60 caracteres)." />
        <ul className="divide-y divide-border">
          {inCat.map((i) => {
            const miss = missingKeywords(i.title, [...trends, ...topTitles], 6);
            const sug = buildTitle(i.title, miss);
            return (
              <li key={i.item_id} className="space-y-1 px-5 py-3 text-sm">
                <Link href={`/mercadolibre/publicaciones/${i.item_id}`} className="font-medium hover:underline">{i.title}</Link>
                <span className="ml-2 text-xs text-fg-subtle">{i.title.length} caract. · {i.visits_30d ?? 0} visitas / {i.sold_30d ?? 0} ventas en 30 días</span>
                {miss.length ? (
                  <div className="flex flex-wrap items-center gap-1.5">
                    {miss.map((w) => <Badge key={w} tone="info">{w}</Badge>)}
                    {sug !== i.title && <><span className="text-xs text-fg-subtle">→</span> <span className="text-xs">{sug}</span> <CopyButton text={sug} /></>}
                  </div>
                ) : <p className="text-xs text-accent">Ya tiene las palabras clave principales.</p>}
              </li>
            );
          })}
        </ul>
      </Card>

      <Card className="mt-5">
        <CardHeader title="Armador de títulos" description="Escribí el producto y sumá palabras con un clic, sin pasarte de 60." />
        <CardBody><TitleBuilder suggestions={[...new Set([...gaps.map((g) => g.word), ...searchWords.map((w) => w.word)])].slice(0, 30)} /></CardBody>
      </Card>
    </>
  );
}
