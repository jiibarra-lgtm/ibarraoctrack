import type { Metadata } from "next";
import Link from "next/link";
import { Badge, Card, CardBody, CardHeader, PageHeader } from "@/components/ui/primitives";
import { formatMoney } from "@/lib/format";
import { mlPage, ITEM_COLS, type ItemRow } from "@/lib/ml/page";
import { netPerUnit } from "@/lib/ml/logic";
import { cn } from "@/lib/utils";
import { CostInput, PriceRuleEditor, SettingToggle } from "../pro-ui";
import { NotConnected, pct } from "../pro-shared";
import { PriceSimulator } from "./simulator";

export const metadata: Metadata = { title: "Mercado Libre · Precios" };
export const dynamic = "force-dynamic";

type SellerPromo = { id: string; type: string; name?: string; status: string; start_date?: string; finish_date?: string; deadline_date?: string; benefits?: { meli_percent?: number; seller_percent?: number } };
const VIEWS = [["rentabilidad", "Rentabilidad"], ["automatico", "Precio automático"], ["promos", "Promociones de ML"], ["simulador", "Simulador"]] as const;

export default async function MlPrices({ searchParams }: { searchParams: Promise<{ v?: string }> }) {
  const v = (await searchParams).v ?? "rentabilidad";
  const { sb, org, ml, edit } = await mlPage();
  if (!ml) return (<><PageHeader title="Precios" /><NotConnected /></>);
  const [itemsQ, rulesQ, settingsQ] = await Promise.all([
    sb.from("ml_items").select(ITEM_COLS).eq("org_id", org).neq("status", "closed"),
    sb.from("ml_price_rules").select("*").eq("org_id", org),
    sb.from("ml_settings").select("repricing").eq("org_id", org).maybeSingle(),
  ]);
  const items = (itemsQ.data ?? []) as unknown as ItemRow[];
  const rules = new Map((rulesQ.data ?? []).map((r) => [r.item_id, r]));
  const promos = v === "promos" ? await ml.get<{ results: SellerPromo[] }>(`/seller-promotions/users/${ml.userId}?app_version=v2`) : null;

  const rows = items.map((i) => ({ i, n: i.price ? netPerUnit({ price: i.price, fee: i.fee_unit, ship: i.ship_cost, cost: i.cost_unit }) : null }))
    .sort((a, b) => (a.n?.margin ?? 999) - (b.n?.margin ?? 999));
  const withCost = rows.filter((r) => r.n?.net !== null && r.n?.net !== undefined);
  const losing = withCost.filter((r) => (r.n!.net ?? 0) < 0);
  const avgMargin = withCost.length ? withCost.reduce((a, r) => a + (r.n!.margin ?? 0), 0) / withCost.length : null;

  return (
    <>
      <PageHeader title="Precios y promociones" description="Lo que te queda en cada publicación, precio automático para ganar el catálogo o seguir a la competencia, y las campañas de ML." />
      <div className="mb-3 flex flex-wrap gap-1.5">
        {VIEWS.map(([k, l]) => <Link key={k} href={`/mercadolibre/precios?v=${k}`} className={cn("rounded-full px-3 py-1 text-xs font-semibold", v === k ? "bg-primary text-primary-fg" : "bg-field text-fg-muted hover:text-fg")}>{l}</Link>)}
      </div>

      {v === "rentabilidad" && (
        <>
          <div className="mb-4 grid gap-3 sm:grid-cols-3">
            <Card><CardBody><p className="text-2xl font-semibold tabular">{pct(avgMargin)}</p><p className="text-sm text-fg-muted">margen promedio ({withCost.length} con costo)</p></CardBody></Card>
            <Card><CardBody><p className={cn("text-2xl font-semibold tabular", losing.length && "text-danger")}>{losing.length}</p><p className="text-sm text-fg-muted">publicaciones a pérdida</p></CardBody></Card>
            <Card><CardBody><p className="text-2xl font-semibold tabular">{rows.length - withCost.length}</p><p className="text-sm text-fg-muted">sin costo cargado</p></CardBody></Card>
          </div>
          <Card>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[900px] text-sm">
                <thead className="text-left text-xs text-fg-subtle"><tr className="border-b border-border">
                  <th className="px-4 py-2">Publicación</th><th className="px-3 text-right">Precio</th><th className="px-3 text-right">Comisión</th><th className="px-3 text-right">Envío</th><th className="px-3">Costo</th><th className="px-3 text-right">Te queda</th><th className="px-3 text-right">Margen</th><th className="px-3 text-right">Ganancia 30d</th>
                </tr></thead>
                <tbody>
                  {rows.map(({ i, n }) => (
                    <tr key={i.item_id} className="border-b border-border last:border-0">
                      <td className="max-w-[320px] px-4 py-2"><Link href={`/mercadolibre/publicaciones/${i.item_id}`} className="line-clamp-1 hover:underline">{i.title}</Link></td>
                      <td className="px-3 text-right tabular">{formatMoney(i.price)}</td>
                      <td className="px-3 text-right tabular">{n ? formatMoney(n.fee) : "—"}</td>
                      <td className="px-3 text-right tabular">{n?.ship ? formatMoney(n.ship) : "—"}</td>
                      <td className="px-3"><CostInput id={i.item_id} cost={i.cost_unit} canEdit={edit} /></td>
                      <td className={cn("px-3 text-right tabular", (n?.net ?? 0) < 0 && "text-danger")}>{n?.net !== null && n?.net !== undefined ? formatMoney(n.net) : "—"}</td>
                      <td className="px-3 text-right tabular">{pct(n?.margin)}</td>
                      <td className="px-3 text-right tabular">{n?.net !== null && n?.net !== undefined ? formatMoney(n.net * (i.sold_30d ?? 0)) : "—"}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            <CardBody className="border-t border-border text-xs text-fg-subtle">Comisión y envío reales de ML (se actualizan cada 3 horas). Todo sin IVA. El costo lo cargás vos (por unidad, sin IVA).</CardBody>
          </Card>
        </>
      )}

      {v === "automatico" && (
        <Card>
          <CardHeader title="Precio automático (repricing)" description="Cada 10 minutos ajusta el precio según la regla, sin bajar del piso ni subir del techo. Cada cambio queda en el historial." />
          {edit && <CardBody className="border-b border-border"><SettingToggle field="repricing" value={!!settingsQ.data?.repricing} label="Activar el precio automático" hint="Si está apagado, las reglas se guardan pero no se aplican." /></CardBody>}
          <ul className="divide-y divide-border">
            {items.filter((i) => i.status === "active").map((i) => {
              const r = rules.get(i.item_id);
              return (
                <li key={i.item_id} className="space-y-1.5 px-5 py-3 text-sm">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <Link href={`/mercadolibre/publicaciones/${i.item_id}`} className="font-medium hover:underline">{i.title}</Link>
                    <span className="text-xs text-fg-subtle">{formatMoney(i.price)}{i.catalog_listing ? ` · catálogo ${i.competition === "winning" ? "ganando" : i.price_to_win ? `· se gana con ${formatMoney(i.price_to_win)}` : ""}` : ""}</span>
                  </div>
                  {edit && <PriceRuleEditor itemId={i.item_id} price={i.price ?? 0} rule={r ?? undefined} />}
                </li>
              );
            })}
          </ul>
          <CardBody className="border-t border-border text-xs text-fg-subtle">“Igualar al más barato” usa las publicaciones que seguís en Mercado y competencia (asociadas a la tuya). “Ganar el catálogo” usa el precio para ganar que informa ML.</CardBody>
        </Card>
      )}

      {v === "promos" && (
        <Card>
          <CardHeader title="Campañas y promociones de Mercado Libre" description="Para sumar una publicación, entrá a la publicación (ahí ves el precio sugerido y te sumás con un clic)." />
          {!promos?.ok ? <CardBody className="text-sm text-fg-muted">No se pudieron leer las promociones ({promos?.error}).</CardBody>
            : (promos.data.results ?? []).length === 0 ? <CardBody className="text-sm text-fg-muted">No hay campañas disponibles ahora.</CardBody> : (
              <ul className="divide-y divide-border text-sm">
                {promos.data.results.map((p) => (
                  <li key={`${p.type}-${p.id}`} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2.5">
                    <div>
                      <p className="font-medium">{p.name ?? p.type}</p>
                      <p className="text-xs text-fg-subtle">{p.type}{p.start_date ? ` · ${p.start_date.slice(0, 10)} → ${p.finish_date?.slice(0, 10) ?? ""}` : ""}{p.deadline_date ? ` · sumarse antes del ${p.deadline_date.slice(0, 10)}` : ""}</p>
                    </div>
                    <div className="flex items-center gap-2">
                      {p.benefits?.meli_percent ? <Badge tone="accent">ML pone {p.benefits.meli_percent} %</Badge> : null}
                      <Badge tone={p.status === "started" ? "accent" : "neutral"}>{p.status === "started" ? "En curso" : p.status === "pending" ? "Próxima" : p.status}</Badge>
                    </div>
                  </li>
                ))}
              </ul>
            )}
        </Card>
      )}

      {v === "simulador" && (
        <Card>
          <CardHeader title="Simulador de precio" description="Probá precios, comisiones, envío e IIBB antes de publicar o cambiar." />
          <CardBody><PriceSimulator iibb={0} /></CardBody>
        </Card>
      )}
    </>
  );
}
