import "server-only";
import type { ApiOrder, Ml } from "@/lib/ml/client";
import { DEFAULT_RULES, extraCost, shipCostOf, type ProfitRules } from "@/lib/ml/prefs";

/**
 * Datos del tablero de estadísticas de Mercado Libre: ventas, publicidad (Product Ads) y visitas, día por día.
 * Todo se calcula en pesos; la conversión a dólares la hace la pantalla.
 */
export type DayBase = {
  date: string; sales: number; orders: number; units: number; fees: number; cogs: number; noCost: number; cancelled: number; ship: number; extra: number; adProfit: number;
  adCost: number; adRevenue: number; adUnits: number; clicks: number; prints: number; visits: number;
};
export const emptyDay = (date: string): DayBase => ({ date, sales: 0, orders: 0, units: 0, fees: 0, cogs: 0, noCost: 0, cancelled: 0, ship: 0, extra: 0, adProfit: 0, adCost: 0, adRevenue: 0, adUnits: 0, clicks: 0, prints: 0, visits: 0 });

const DAY = 864e5;
export const addDays = (d: string, n: number) => new Date(Date.parse(`${d}T00:00:00Z`) + n * DAY).toISOString().slice(0, 10);
export const daysBetween = (a: string, b: string) => Math.round((Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`)) / DAY) + 1;
const arDay = (iso: string) => new Date(Date.parse(iso) - 3 * 3600e3).toISOString().slice(0, 10);

/** Órdenes entre dos fechas (hora Argentina), usando el filtro de fecha de la API. */
export async function ordersBetween(ml: Ml, from: string, to: string) {
  const out: ApiOrder[] = [];
  const f = encodeURIComponent(`${from}T00:00:00.000-03:00`), t = encodeURIComponent(`${to}T23:59:59.999-03:00`);
  for (let offset = 0; offset < 5000; offset += 50) {
    const r = await ml.get<{ results: ApiOrder[]; paging: { total: number } }>(
      `/orders/search?seller=${ml.userId}&order.date_created.from=${f}&order.date_created.to=${t}&sort=date_asc&limit=50&offset=${offset}`);
    if (!r.ok) { if (!out.length) throw new Error(r.error ?? "No se pudieron leer las ventas"); break; }
    out.push(...(r.data.results ?? []));
    if ((r.data.results ?? []).length < 50 || out.length >= r.data.paging.total) break;
  }
  return out;
}

type AdRow = { date?: string; cost?: number; total_amount?: number; units_quantity?: number; clicks?: number; prints?: number };

/** Product Ads por día (suma de todas las campañas). Devuelve null si la cuenta no tiene publicidad o no hay permiso. */
async function adsBetween(ml: Ml, from: string, to: string): Promise<{ rows: AdRow[] } | { error: string }> {
  const adv = await ml.raw(`/advertising/advertisers?product_id=PADS`, { headers: { "api-version": "1", accept: "application/json" } });
  const advJ = (await adv.json().catch(() => null)) as { advertisers?: { advertiser_id: number; site_id: string }[]; message?: string } | null;
  if (!adv.ok) return { error: advJ?.message ?? `Error ${adv.status}` };
  const a = advJ?.advertisers?.find((x) => x.site_id === "MLA") ?? advJ?.advertisers?.[0];
  if (!a) return { error: "La cuenta no tiene Product Ads activado." };
  const metrics = "clicks,prints,cost,total_amount,units_quantity";
  const rows: AdRow[] = [];
  for (let offset = 0; offset < 5000; offset += 50) {
    const r = await ml.raw(`/advertising/${a.site_id}/advertisers/${a.advertiser_id}/product_ads/campaigns/search?limit=50&offset=${offset}&date_from=${from}&date_to=${to}&metrics=${metrics}&aggregation_type=DAILY`,
      { headers: { "api-version": "2", accept: "application/json" } });
    const j = (await r.json().catch(() => null)) as { results?: AdRow[]; paging?: { total: number }; message?: string } | null;
    if (!r.ok) return rows.length ? { rows } : { error: j?.message ?? `Error ${r.status}` };
    rows.push(...(j?.results ?? []));
    if ((j?.results ?? []).length < 50 || rows.length >= (j?.paging?.total ?? 0)) break;
  }
  return { rows };
}

/** Visitas totales de la cuenta por día. */
async function visitsBetween(ml: Ml, from: string, to: string) {
  const r = await ml.get<{ results?: { date: string; total: number }[] }>(`/users/${ml.userId}/items_visits/time_window?last=${daysBetween(from, to)}&unit=day&ending=${to}`);
  return r.ok ? r.data.results ?? [] : null;
}

export type ItemAgg = { item_id: string; title: string; units: number; orders: number; sales: number; fees: number; cogs: number; noCost: number; ship: number; extra: number; clients: number; daily: { units: number; sales: number }[] };
/** Una venta del período, con su detalle para el panel lateral. */
export type SaleRow = {
  id: number; pack: number | null; date: string; status: string; buyer: string | null; total: number; fees: number; cogs: number | null; ship: number; extra: number;
  installments: number | null; payment: string | null;
  items: { item_id: string; title: string; qty: number; unit: number; fee: number; cost: number | null }[];
};
/** Ventas por día de la semana (0 = domingo) y hora (hora Argentina). */
export type Heat = number[][];

/** Arma los días de [from, to] con todo sumado. */
export async function loadStats(ml: Ml, from: string, to: string, cost: Map<string, number | null>, shipCost: Map<string, number | null> = new Map(), rules: ProfitRules = DEFAULT_RULES) {
  const [orders, ads, visits] = await Promise.all([
    ordersBetween(ml, from, to),
    adsBetween(ml, from, to).catch((e: Error) => ({ error: e.message })),
    visitsBetween(ml, from, to).catch(() => null),
  ]);
  const days = new Map<string, DayBase>();
  const items = new Map<string, ItemAgg>();
  const buyers = new Map<string, Set<number>>();
  const dayIdx = new Map<string, number>();
  const sales: SaleRow[] = [];
  const heat: Heat = Array.from({ length: 7 }, () => Array(24).fill(0));
  for (let d = from; d <= to; d = addDays(d, 1)) { dayIdx.set(d, days.size); days.set(d, emptyDay(d)); }
  const nDays = days.size;
  for (const o of orders) {
    const dKey = arDay(o.date_created);
    const day = days.get(dKey);
    if (!day) continue;
    // envío a cargo del vendedor (estimado): el costo de envío de la publicación, una vez por orden
    const ship = o.status === "cancelled" ? 0 : shipCostOf(rules, Math.max(0, ...o.order_items.map((it) => Number(shipCost.get(it.item.id) ?? 0))));
    const extra = o.status === "cancelled" ? 0 : extraCost(rules, Number(o.total_amount), o.order_items.reduce((a, it) => a + it.quantity, 0));
    const lines = o.order_items.map((it) => ({ item_id: it.item.id, title: it.item.title ?? it.item.id, qty: it.quantity, unit: Number(it.unit_price ?? 0), fee: Number(it.sale_fee ?? 0) * it.quantity, cost: cost.get(it.item.id) ?? null }));
    sales.push({
      id: o.id, pack: o.pack_id ?? null, date: o.date_created, status: o.status, buyer: o.buyer?.nickname ?? null, total: Number(o.total_amount),
      fees: lines.reduce((a, l) => a + l.fee, 0), ship, extra,
      cogs: lines.every((l) => l.cost !== null) ? lines.reduce((a, l) => a + (l.cost ?? 0) * l.qty, 0) : null,
      installments: o.payments?.[0]?.installments ?? null, payment: o.payments?.[0]?.payment_type ?? null, items: lines,
    });
    if (o.status === "cancelled") { day.cancelled++; continue; }
    day.sales += Number(o.total_amount); day.orders++; day.ship += ship; day.extra += extra;
    const local = new Date(Date.parse(o.date_created) - 3 * 3600e3);
    heat[local.getUTCDay()][local.getUTCHours()] += 1;
    const lineSum = o.order_items.reduce((a, it) => a + Number(it.unit_price ?? 0) * it.quantity, 0) || 1;
    for (const it of o.order_items) {
      day.units += it.quantity; day.fees += Number(it.sale_fee ?? 0) * it.quantity;
      const c = cost.get(it.item.id);
      if (c === null || c === undefined) day.noCost += it.quantity; else day.cogs += c * it.quantity;
      const ag = items.get(it.item.id) ?? { item_id: it.item.id, title: it.item.title ?? it.item.id, units: 0, orders: 0, sales: 0, fees: 0, cogs: 0, noCost: 0, ship: 0, extra: 0, clients: 0,
        daily: Array.from({ length: nDays }, () => ({ units: 0, sales: 0 })) };
      const share = (Number(it.unit_price ?? 0) * it.quantity) / lineSum;
      ag.units += it.quantity; ag.orders += 1;
      ag.sales += Number(o.total_amount) * share;
      ag.ship += ship * share; ag.extra += extra * share;
      const di = dayIdx.get(dKey)!;
      ag.daily[di].units += it.quantity; ag.daily[di].sales += Number(o.total_amount) * share;
      if (o.buyer?.id) { const b = buyers.get(it.item.id) ?? new Set<number>(); b.add(o.buyer.id); buyers.set(it.item.id, b); }
      ag.fees += Number(it.sale_fee ?? 0) * it.quantity;
      if (c === null || c === undefined) ag.noCost += it.quantity; else ag.cogs += c * it.quantity;
      items.set(it.item.id, ag);
    }
  }
  if ("rows" in ads) for (const r of ads.rows) {
    const day = r.date ? days.get(r.date.slice(0, 10)) : undefined;
    if (!day) continue;
    day.adCost += Number(r.cost ?? 0); day.adRevenue += Number(r.total_amount ?? 0); day.adUnits += Number(r.units_quantity ?? 0);
    day.clicks += Number(r.clicks ?? 0); day.prints += Number(r.prints ?? 0);
  }
  for (const d of days.values()) d.adProfit = rules.adsInProfit ? d.adCost : 0;
  if (visits) for (const v of visits) { const day = days.get(v.date.slice(0, 10)); if (day) day.visits += Number(v.total ?? 0); }
  for (const [id, b] of buyers) { const ag = items.get(id); if (ag) ag.clients = b.size; }
  sales.sort((a, b) => b.date.localeCompare(a.date));
  return { days: [...days.values()], items: [...items.values()].sort((a, b) => b.sales - a.sales), heat, sales: sales.slice(0, 300), adsError: "error" in ads ? ads.error : null, visitsOk: visits !== null };
}

/** Dólar oficial (venta) para mostrar en USD. */
export async function usdRate(): Promise<number | null> {
  try {
    const r = await fetch("https://dolarapi.com/v1/dolares/oficial", { next: { revalidate: 3600 } });
    if (!r.ok) return null;
    const j = (await r.json()) as { venta?: number };
    return j.venta && j.venta > 0 ? j.venta : null;
  } catch { return null; }
}
