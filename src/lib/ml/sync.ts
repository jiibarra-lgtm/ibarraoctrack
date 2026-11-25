import "server-only";
import type { MlRpc } from "@/lib/ml-api";
import { pool, type ApiItem, type ApiOrder, type ApiPerformance, type Ml } from "@/lib/ml/client";
import { abWinner, inBusinessHours, matchAnswer, personalize, repriceTarget, type AbResults, type AutoAnswer, type PriceRule } from "@/lib/ml/logic";

/**
 * Tareas automáticas de la sección Mercado Libre. Corre cada 10 minutos con el script de Gmail
 * (y a mano desde la pantalla). Lo pesado (visitas, salud, comisión) se refresca cada 3 horas.
 */
type Store = MlRpc;
const rows = async <T,>(store: Store, table: string) => ((await store("select", { table })).rows ?? []) as T[];
const upsert = (store: Store, table: string, list: Record<string, unknown>[]) => list.length ? store("upsert", { table, rows: list }) : Promise.resolve({});
const patch = (store: Store, table: string, list: Record<string, unknown>[]) => list.length ? store("patch", { table, rows: list }) : Promise.resolve({});
const event = (store: Store, e: { kind: string; title: string; detail?: string; ref?: string; url?: string }) => store("event", e).catch(() => null);
const hoursAgo = (iso: string | null | undefined, h: number) => !iso || Date.now() - Date.parse(iso) > h * 3600e3;
const arDay = (d = new Date()) => new Date(d.getTime() - 3 * 3600e3).toISOString().slice(0, 10);

export type Settings = {
  auto_answers: boolean; vacation: boolean; vacation_items: string[]; repricing: boolean; hours_from: number; hours_to: number;
  work_days: number[]; off_hours_answer: string | null; desc_template: string | null;
};
type ItemRow = { item_id: string; title: string; price: number | null; available: number | null; sold: number | null; status: string | null; health: number | null; metrics_at: string | null;
  cost_unit: number | null; price_to_win: number | null; fee_unit: number | null; sub_status: string[] | null };

// ---------------------------------------------------------------------------
// Publicaciones
// ---------------------------------------------------------------------------
export async function listAllItemIds(ml: Ml) {
  const ids: string[] = [];
  for (const status of ["active", "paused", "under_review", "inactive"]) {
    for (let offset = 0; offset < 1000; offset += 100) {
      const r = await ml.get<{ results: string[]; paging: { total: number } }>(`/users/${ml.userId}/items/search?status=${status}&limit=100&offset=${offset}`);
      if (!r.ok) break;
      ids.push(...r.data.results);
      if (r.data.results.length < 100 || offset + 100 >= r.data.paging.total) break;
    }
  }
  return [...new Set(ids)];
}

export async function getItems(ml: Ml, ids: string[]) {
  const out: ApiItem[] = [];
  for (let i = 0; i < ids.length; i += 20) {
    const r = await ml.get<{ code: number; body: ApiItem }[]>(`/items?ids=${ids.slice(i, i + 20).join(",")}`);
    if (r.ok) out.push(...r.data.filter((x) => x.code === 200).map((x) => x.body));
  }
  return out;
}

/** Ventas de los últimos N días (vendedor). */
export async function recentSales(ml: Ml, days = 30) {
  const since = Date.now() - days * 864e5;
  const out: ApiOrder[] = [];
  for (let offset = 0; offset < 1000; offset += 50) {
    const r = await ml.get<{ results: ApiOrder[]; paging: { total: number } }>(`/orders/search?seller=${ml.userId}&sort=date_desc&limit=50&offset=${offset}`);
    if (!r.ok) break;
    out.push(...r.data.results);
    const last = r.data.results.at(-1);
    if (!last || r.data.results.length < 50 || Date.parse(last.date_created) < since) break;
  }
  return out.filter((o) => Date.parse(o.date_created) >= since);
}

export async function syncListings(ml: Ml, store: Store, opts: { force?: boolean } = {}) {
  const [ids, prev, sales] = await Promise.all([listAllItemIds(ml), rows<ItemRow>(store, "ml_items"), recentSales(ml, 30)]);
  const items = await getItems(ml, ids);
  const before = new Map(prev.map((p) => [p.item_id, p]));
  const sold30 = new Map<string, number>();
  for (const o of sales.filter((x) => x.status !== "cancelled")) for (const it of o.order_items) sold30.set(it.item.id, (sold30.get(it.item.id) ?? 0) + it.quantity);
  const heavy = opts.force || prev.length === 0 || prev.some((p) => hoursAgo(p.metrics_at, 3));
  const today = arDay();

  const extra = new Map<string, Record<string, unknown>>();
  if (heavy) {
    await pool(items, 4, async (it) => {
      const x: Record<string, unknown> = { metrics_at: new Date().toISOString() };
      const [visits, perf, fee, ship, ptw] = await Promise.all([
        ml.get<{ total_visits: number; results: { date: string; total: number }[] }[]>(`/items/visits/time_window?ids=${it.id}&last=30&unit=day`),
        ml.get<ApiPerformance>(`/item/${it.id}/performance`),
        ml.get<{ sale_fee_amount: number }>(`/sites/MLA/listing_prices?price=${it.price}&category_id=${it.category_id}&listing_type_id=${it.listing_type_id}`),
        it.shipping?.free_shipping ? ml.get<{ coverage?: { all_country?: { list_cost?: number } } }>(`/users/${ml.userId}/shipping_options/free?item_id=${it.id}`) : Promise.resolve(null),
        ml.get<{ price_to_win: number | null; status: string }>(`/items/${it.id}/price_to_win?siteId=MLA&version=v2`),
      ]);
      if (visits.ok) {
        const v = Array.isArray(visits.data) ? visits.data[0] : null;
        x.visits_30d = v?.total_visits ?? 0;
        const yesterday = new Date(Date.parse(`${today}T12:00:00Z`) - 864e5).toISOString().slice(0, 10);
        x._visits_y = v?.results?.find((r) => r.date.startsWith(yesterday))?.total ?? 0;
      }
      if (perf.ok) {
        x.health = perf.data.score;
        x.warnings = (perf.data.buckets ?? []).flatMap((b) => (b.variables ?? []).filter((v) => v.status !== "COMPLETED")
          .map((v) => ({ title: v.title, score: v.score, link: v.rules?.find((r) => r.wordings?.link)?.wordings?.link ?? null }))).slice(0, 8);
      }
      if (fee.ok) x.fee_unit = fee.data.sale_fee_amount;
      if (ship?.ok) x.ship_cost = ship.data.coverage?.all_country?.list_cost ?? null;
      if (ptw.ok) { x.price_to_win = ptw.data.price_to_win; x.competition = ptw.data.status; }
      extra.set(it.id, x);
    });
  }

  const list: Record<string, unknown>[] = [];
  const history: Record<string, unknown>[] = [];
  const daily: Record<string, unknown>[] = [];
  for (const it of items) {
    const p = before.get(it.id);
    const x = extra.get(it.id) ?? {};
    const row: Record<string, unknown> = {
      item_id: it.id, title: it.title, available: it.available_quantity, sold: it.sold_quantity, price: it.price, status: it.status,
      logistic: it.shipping?.logistic_type ?? null, permalink: it.permalink, thumbnail: it.thumbnail?.replace(/^http:/, "https:") ?? null,
      variations: it.variations?.length ?? 0, seen_at: new Date().toISOString(), category_id: it.category_id, listing_type: it.listing_type_id,
      catalog_listing: !!it.catalog_listing, sub_status: it.sub_status ?? [], date_created: it.date_created ?? null, sold_30d: sold30.get(it.id) ?? 0,
    };
    for (const [k, v] of Object.entries(x)) if (!k.startsWith("_")) row[k] = v;
    list.push(row);
    if (p) {
      for (const [f, a, b] of [["price", p.price, it.price], ["title", p.title, it.title], ["status", p.status, it.status]] as const)
        if (a !== null && String(a) !== String(b)) history.push({ item_id: it.id, field: f, old_value: String(a), new_value: String(b), source: "ml" });
      if (p.status === "active" && it.status !== "active")
        await event(store, { kind: "baja", title: `Publicación ${it.status === "paused" ? "pausada" : it.status}: ${it.title}`, detail: (it.sub_status ?? []).join(", ") || undefined, ref: `${it.id}:${it.status}:${today}`, url: `/mercadolibre/publicaciones/${it.id}` });
      if ((p.available ?? 0) > 0 && it.available_quantity === 0)
        await event(store, { kind: "stock", title: `Sin stock: ${it.title}`, ref: `${it.id}:sin-stock:${today}`, url: `/mercadolibre/publicaciones/${it.id}` });
    }
    daily.push({ item_id: it.id, day: today, sold_total: it.sold_quantity, price: it.price, available: it.available_quantity, ...(x._visits_y !== undefined ? { visits: x._visits_y } : {}) });
  }
  // ml_items tiene columnas propias de reposición: se guarda por lotes del mismo formato
  const withMetrics = list.filter((r) => r.metrics_at), without = list.filter((r) => !r.metrics_at);
  await upsert(store, "ml_items", withMetrics);
  await upsert(store, "ml_items", without);
  if (history.length) await upsert(store, "ml_item_history", history);
  // la foto diaria se guarda una vez con visitas (si se calcularon) y si no, sin pisar visitas
  const dv = daily.filter((d) => d.visits !== undefined), dn = daily.filter((d) => d.visits === undefined);
  await upsert(store, "ml_item_daily", dv);
  await upsert(store, "ml_item_daily", dn);
  return { items: items.length, metrics: heavy, sales: sales.length };
}

// ---------------------------------------------------------------------------
// Ventas nuevas → aviso
// ---------------------------------------------------------------------------
export async function syncSaleEvents(ml: Ml, store: Store) {
  const sales = await recentSales(ml, 2);
  for (const o of sales.filter((x) => x.status === "paid")) {
    const items = o.order_items.map((i) => `${i.quantity} × ${i.item.title}`).join(", ");
    await event(store, { kind: "venta", title: `Nueva venta: $ ${Math.round(o.total_amount).toLocaleString("es-AR")}`, detail: items, ref: String(o.pack_id ?? o.id), url: "/mercadolibre/ventas" });
  }
  return { ventas: sales.length };
}

// ---------------------------------------------------------------------------
// Preguntas (y respuesta automática)
// ---------------------------------------------------------------------------
type ApiQuestion = { id: number; item_id: string; text: string; status: string; date_created: string; from?: { id: number }; answer?: { text: string; date_created: string } | null };

export async function syncQuestions(ml: Ml, store: Store, settings: Settings | null) {
  const r = await ml.get<{ questions: ApiQuestion[] }>(`/questions/search?seller_id=${ml.userId}&api_version=4&sort_fields=date_created&sort_types=DESC&limit=50`);
  if (!r.ok) return { error: r.error };
  const qs = r.data.questions ?? [];
  const known = new Map((await rows<{ id: string; status: string; answered_by: string | null }>(store, "ml_questions")).map((q) => [q.id, q]));
  const titles = new Map((await rows<{ item_id: string; title: string }>(store, "ml_items")).map((i) => [i.item_id, i.title]));
  const rules = settings?.auto_answers ? (await rows<AutoAnswer>(store, "ml_auto_answers")) : [];
  const out: Record<string, unknown>[] = [];
  let auto = 0;
  for (const q of qs) {
    const row: Record<string, unknown> = {
      id: String(q.id), item_id: q.item_id, item_title: titles.get(q.item_id) ?? null, text: q.text, status: q.status, from_id: q.from?.id ? String(q.from.id) : null,
      date_created: q.date_created, answer: q.answer?.text ?? null, answered_at: q.answer?.date_created ?? null,
    };
    const isNew = !known.has(String(q.id));
    if (q.status === "UNANSWERED") {
      if (isNew) await event(store, { kind: "pregunta", title: `Pregunta nueva: ${q.text.slice(0, 80)}`, detail: titles.get(q.item_id) ?? q.item_id, ref: String(q.id), url: "/mercadolibre/preguntas" });
      if (settings?.auto_answers && (Date.now() - Date.parse(q.date_created)) < 3 * 864e5) {
        const offHours = !inBusinessHours(new Date(), settings.hours_from, settings.hours_to, settings.work_days);
        const rule = matchAnswer(q.text, rules);
        const text = rule ? rule.answer : offHours ? settings.off_hours_answer : null;
        if (text) {
          const a = await ml.post(`/answers`, { question_id: q.id, text: personalize(text) });
          if (a.ok) {
            row.status = "ANSWERED"; row.answer = text; row.answered_at = new Date().toISOString(); row.answered_by = rule ? `auto:${rule.name}` : "auto:fuera de horario";
            if (rule) await store("answer_used", { id: rule.id }).catch(() => null);
            auto++;
          }
        }
      }
    } else if (known.get(String(q.id))?.answered_by) {
      row.answered_by = known.get(String(q.id))!.answered_by;
    }
    out.push(row);
  }
  await upsert(store, "ml_questions", out);
  return { preguntas: qs.length, auto };
}

// ---------------------------------------------------------------------------
// Reclamos (donde soy vendedor)
// ---------------------------------------------------------------------------
type ApiClaim = { id: number; resource_id: number; status: string; type: string; stage: string; reason_id: string; date_created: string; last_updated: string;
  players: { role: string; type: string; user_id: number; available_actions?: { action: string; due_date?: string; mandatory?: boolean }[] }[] };

export async function syncClaims(ml: Ml, store: Store) {
  const r = await ml.get<{ data: ApiClaim[] }>(`/post-purchase/v1/claims/search?status=opened&limit=50`);
  if (!r.ok) return { error: r.error };
  const known = new Set((await rows<{ id: string }>(store, "ml_claims")).map((c) => c.id));
  const mine = (r.data.data ?? []).filter((c) => c.players.some((p) => p.type === "seller" && p.user_id === ml.userId));
  const out: Record<string, unknown>[] = [];
  for (const c of mine) {
    const me = c.players.find((p) => p.user_id === ml.userId);
    const next = (me?.available_actions ?? []).sort((a, b) => (a.due_date ?? "9").localeCompare(b.due_date ?? "9"))[0];
    out.push({ id: String(c.id), resource_id: String(c.resource_id), type: c.type, stage: c.stage, status: c.status, reason: c.reason_id,
      date_created: c.date_created, due_date: next?.due_date ?? null, action_needed: next?.action ?? null, data: c, updated_at: new Date().toISOString() });
    if (!known.has(String(c.id))) await event(store, { kind: "reclamo", title: `Reclamo nuevo (${c.type})`, detail: `Venta ${c.resource_id}${next?.due_date ? ` · responder antes del ${next.due_date.slice(0, 10)}` : ""}`, ref: String(c.id), url: "/mercadolibre/preguntas?v=reclamos" });
  }
  await upsert(store, "ml_claims", out);
  return { reclamos: mine.length };
}

// ---------------------------------------------------------------------------
// Reputación (una foto por día)
// ---------------------------------------------------------------------------
type ApiUser = { seller_reputation?: { level_id: string | null; power_seller_status: string | null; transactions?: { total: number; completed: number; canceled: number; ratings?: { positive: number; negative: number; neutral: number } };
  metrics?: { sales?: { completed: number }; claims?: { rate: number }; delayed_handling_time?: { rate: number }; cancellations?: { rate: number } } } };

export async function syncReputation(ml: Ml, store: Store) {
  const r = await ml.get<ApiUser>(`/users/${ml.userId}`);
  if (!r.ok || !r.data.seller_reputation) return { error: r.error };
  const s = r.data.seller_reputation;
  await upsert(store, "ml_reputation", [{
    day: arDay(), level: s.level_id, power_seller: s.power_seller_status, sales_60d: s.metrics?.sales?.completed ?? null,
    claims_rate: s.metrics?.claims?.rate ?? null, delayed_rate: s.metrics?.delayed_handling_time?.rate ?? null, cancel_rate: s.metrics?.cancellations?.rate ?? null,
    positive_pct: s.transactions?.ratings ? s.transactions.ratings.positive * 100 : null, data: s,
  }]);
  return { nivel: s.level_id };
}

// ---------------------------------------------------------------------------
// Competencia: publicaciones, productos de catálogo y vendedores seguidos
// ---------------------------------------------------------------------------
type Comp = { id: string; kind: "item" | "seller"; ref: string; label: string | null; my_item_id: string | null; last: Record<string, unknown> | null; checked_at: string | null };

export async function snapshotCompetitor(ml: Ml, kind: "item" | "seller", ref: string) {
  if (kind === "seller") {
    const u = await ml.get<{ id: number; nickname: string; seller_reputation?: { level_id: string; power_seller_status: string | null; transactions?: { total: number } }; permalink: string }>(`/users/${ref}`);
    if (!u.ok) return null;
    return { label: u.data.nickname, last: { nickname: u.data.nickname, level: u.data.seller_reputation?.level_id ?? null, power: u.data.seller_reputation?.power_seller_status ?? null, sales: u.data.seller_reputation?.transactions?.total ?? null, permalink: u.data.permalink } };
  }
  const it = await ml.get<ApiItem>(`/items/${ref}`);
  if (it.ok) return { label: it.data.title, last: { title: it.data.title, price: it.data.price, available: it.data.available_quantity, sold: it.data.sold_quantity, status: it.data.status, seller_id: it.data.seller_id ?? null, free_shipping: !!it.data.shipping?.free_shipping, permalink: it.data.permalink, thumbnail: it.data.thumbnail, catalog: false } };
  const p = await ml.get<{ name: string; buy_box_winner?: { price?: number; seller_id?: number; item_id?: string } | null; pictures?: { url: string }[] }>(`/products/${ref}`);
  if (p.ok) return { label: p.data.name, last: { title: p.data.name, price: p.data.buy_box_winner?.price ?? null, seller_id: p.data.buy_box_winner?.seller_id ?? null, status: "catalog", permalink: `https://www.mercadolibre.com.ar/p/${ref}`, thumbnail: p.data.pictures?.[0]?.url ?? null, catalog: true } };
  return null;
}

export async function syncCompetitors(ml: Ml, store: Store) {
  const list = (await rows<Comp>(store, "ml_competitors")).filter((c) => hoursAgo(c.checked_at, 1));
  const out: Record<string, unknown>[] = [];
  for (const c of list.slice(0, 40)) {
    const snap = await snapshotCompetitor(ml, c.kind, c.ref);
    if (!snap) continue;
    const a = c.last ?? {}, b = snap.last as Record<string, unknown>;
    const name = c.label ?? snap.label;
    if (a.price && b.price && Number(b.price) !== Number(a.price))
      await event(store, { kind: "competencia", title: `${name}: ${Number(b.price) < Number(a.price) ? "bajó" : "subió"} el precio`, detail: `$ ${Number(a.price).toLocaleString("es-AR")} → $ ${Number(b.price).toLocaleString("es-AR")}`, ref: `${c.id}:p:${b.price}`, url: "/mercadolibre/mercado?v=competencia" });
    if (a.available && Number(a.available) > 0 && Number(b.available) === 0)
      await event(store, { kind: "competencia", title: `${name}: se quedó sin stock`, ref: `${c.id}:sin-stock:${arDay()}`, url: "/mercadolibre/mercado?v=competencia" });
    if (a.status === "active" && b.status && b.status !== "active")
      await event(store, { kind: "competencia", title: `${name}: pausó la publicación`, ref: `${c.id}:st:${b.status}:${arDay()}`, url: "/mercadolibre/mercado?v=competencia" });
    out.push({ id: c.id, kind: c.kind, ref: c.ref, label: name, last: { ...b, prev_price: a.price ?? null, prev_sold: a.sold ?? null }, checked_at: new Date().toISOString() });
  }
  await patch(store, "ml_competitors", out);
  return { competidores: out.length };
}

// ---------------------------------------------------------------------------
// Repricing automático
// ---------------------------------------------------------------------------
export async function runRepricing(ml: Ml, store: Store, settings: Settings | null) {
  if (!settings?.repricing) return { repricing: "apagado" };
  const [rules, items, comps] = await Promise.all([
    rows<PriceRule & { item_id: string; active: boolean; last_run_at: string | null }>(store, "ml_price_rules"),
    rows<ItemRow>(store, "ml_items"), rows<Comp>(store, "ml_competitors"),
  ]);
  const byId = new Map(items.map((i) => [i.item_id, i]));
  const upd: Record<string, unknown>[] = [];
  let changed = 0;
  for (const r of rules.filter((x) => x.active && hoursAgo(x.last_run_at, 1))) {
    const it = byId.get(r.item_id);
    if (!it || it.status !== "active" || !it.price) continue;
    const lowest = comps.filter((c) => c.my_item_id === r.item_id && c.last?.price).map((c) => Number(c.last!.price)).sort((a, b) => a - b)[0] ?? null;
    const feePct = it.fee_unit && it.price ? (Number(it.fee_unit) / Number(it.price)) * 100 : 14;
    const target = repriceTarget({ strategy: r.strategy, min_price: Number(r.min_price), max_price: r.max_price ? Number(r.max_price) : null, margin_pct: r.margin_pct !== null ? Number(r.margin_pct) : null, step: Number(r.step) },
      { current: Number(it.price), priceToWin: it.price_to_win ? Number(it.price_to_win) : null, lowestCompetitor: lowest, cost: it.cost_unit !== null ? Number(it.cost_unit) : null, feePct });
    let result = "sin cambios";
    if (target) {
      const p = await ml.put(`/items/${r.item_id}`, { price: target });
      result = p.ok ? `precio ${it.price} → ${target}` : `error: ${p.error}`;
      if (p.ok) {
        changed++;
        await upsert(store, "ml_item_history", [{ item_id: r.item_id, field: "price", old_value: String(it.price), new_value: String(target), source: "repricing" }]);
        await event(store, { kind: "precio", title: `Repricing: ${it.title}`, detail: `$ ${Number(it.price).toLocaleString("es-AR")} → $ ${target.toLocaleString("es-AR")}`, ref: `${r.item_id}:${target}`, url: `/mercadolibre/publicaciones/${r.item_id}` });
      }
    }
    upd.push({ item_id: r.item_id, last_run_at: new Date().toISOString(), last_result: result });
  }
  await patch(store, "ml_price_rules", upd);
  return { repricing: changed };
}

// ---------------------------------------------------------------------------
// Pruebas A/B
// ---------------------------------------------------------------------------
type AbTest = { id: string; item_id: string; field: "title" | "price"; variant_a: string; variant_b: string; days_each: number; current: "a" | "b"; switched_at: string; ends_at: string | null; status: string; results: AbResults };

export async function runAbTests(ml: Ml, store: Store) {
  const tests = (await rows<AbTest>(store, "ml_ab_tests")).filter((t) => t.status === "running");
  if (!tests.length) return { ab: 0 };
  const daily = await rows<{ item_id: string; day: string; visits: number | null; sold_total: number | null }>(store, "ml_item_daily");
  const upd: Record<string, unknown>[] = [];
  for (const t of tests) {
    if (Date.now() - Date.parse(t.switched_at) < t.days_each * 864e5) continue;
    const from = t.switched_at.slice(0, 10);
    const d = daily.filter((x) => x.item_id === t.item_id && x.day >= from).sort((a, b) => a.day.localeCompare(b.day));
    const visits = d.reduce((a, x) => a + (x.visits ?? 0), 0);
    const sold = d.length > 1 ? (d.at(-1)!.sold_total ?? 0) - (d[0].sold_total ?? 0) : 0;
    const res: AbResults = JSON.parse(JSON.stringify(t.results));
    res[t.current] = { days: res[t.current].days + t.days_each, visits: res[t.current].visits + visits, sold: res[t.current].sold + Math.max(0, sold) };
    const done = t.ends_at && Date.now() > Date.parse(t.ends_at);
    const next = t.current === "a" ? "b" : "a";
    if (done) {
      const w = abWinner(res);
      const value = (w.winner ?? "a") === "a" ? t.variant_a : t.variant_b;
      await ml.put(`/items/${t.item_id}`, t.field === "price" ? { price: Number(value) } : { title: value });
      await event(store, { kind: "ab", title: `Prueba A/B terminada: ganó la ${(w.winner ?? "a").toUpperCase()}`, detail: w.reason, ref: `ab:${t.id}`, url: `/mercadolibre/publicaciones/${t.item_id}` });
      upd.push({ id: t.id, results: res, status: "done" });
    } else {
      const value = next === "a" ? t.variant_a : t.variant_b;
      const p = await ml.put(`/items/${t.item_id}`, t.field === "price" ? { price: Number(value) } : { title: value });
      upd.push({ id: t.id, results: res, current: p.ok ? next : t.current, switched_at: new Date().toISOString() });
    }
  }
  await patch(store, "ml_ab_tests", upd);
  return { ab: upd.length };
}

// ---------------------------------------------------------------------------
// Modo vacaciones
// ---------------------------------------------------------------------------
export async function applyVacation(ml: Ml, store: Store, on: boolean, settings: Settings | null) {
  if (on) {
    const items = (await rows<ItemRow>(store, "ml_items")).filter((i) => i.status === "active");
    const paused: string[] = [];
    await pool(items, 4, async (i) => { const r = await ml.put(`/items/${i.item_id}`, { status: "paused" }); if (r.ok) paused.push(i.item_id); });
    await patch(store, "ml_settings", [{ vacation: true, vacation_items: paused, updated_at: new Date().toISOString() }]);
    return { pausadas: paused.length };
  }
  const ids = settings?.vacation_items ?? [];
  let back = 0;
  await pool(ids, 4, async (id) => { const r = await ml.put(`/items/${id}`, { status: "active" }); if (r.ok) back++; });
  await patch(store, "ml_settings", [{ vacation: false, vacation_items: [], updated_at: new Date().toISOString() }]);
  return { reactivadas: back };
}

export async function loadSettings(store: Store) {
  return ((await rows<Settings>(store, "ml_settings"))[0] ?? null);
}

/** Todo lo automático de la sección (nunca tira error). */
export async function runMlPro(ml: Ml, store: Store) {
  const out: Record<string, unknown> = {};
  const settings = await loadSettings(store).catch(() => null);
  const step = async (k: string, f: () => Promise<unknown>) => { try { out[k] = await f(); } catch (e) { out[k] = { error: (e as Error).message }; } };
  await step("publicaciones", () => syncListings(ml, store));
  await step("ventas", () => syncSaleEvents(ml, store));
  await step("preguntas", () => syncQuestions(ml, store, settings));
  await step("reclamos", () => syncClaims(ml, store));
  const reps = await rows<{ day: string }>(store, "ml_reputation").catch(() => []);
  if (!reps.some((r) => r.day === arDay())) await step("reputacion", () => syncReputation(ml, store));
  await step("competencia", () => syncCompetitors(ml, store));
  await step("repricing", () => runRepricing(ml, store, settings));
  await step("ab", () => runAbTests(ml, store));
  // de las compras se guarda el detalle sólo de las últimas 100
  await step("compras", () => store("trim_purchases", { keep: 100 }));
  return out;
}
