/**
 * Cálculos de la sección de Mercado Libre (sin red ni base): neto, puntajes, palabras clave, respuestas automáticas,
 * repricing, pruebas A/B, quiebre de stock, duplicadas, calendario comercial. Todo probado en tests/ml-logic.test.ts.
 */
const r2 = (n: number) => Math.round((n + Number.EPSILON) * 100) / 100;
export const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(/[^a-z0-9ñ\s]/g, " ").replace(/\s+/g, " ").trim();

// ---------------------------------------------------------------------------
// Neto por venta
// ---------------------------------------------------------------------------
export type NetInput = { price: number; fee: number | null; ship: number | null; cost: number | null; iibbPct?: number; vatPct?: number; installmentsPct?: number; freeShipping?: boolean };
/**
 * Lo que te queda por unidad vendida: precio − comisión ML − envío (si lo pagás vos) − costo de cuotas − IIBB − costo del producto.
 * El IIBB se calcula sobre el precio sin IVA. El IVA del precio no es ganancia: se descuenta como débito (neto de IVA).
 */
export function netPerUnit(i: NetInput) {
  const vat = i.vatPct ?? 21;
  const priceNet = i.price / (1 + vat / 100);
  const fee = i.fee ?? i.price * 0.14;
  const ship = i.freeShipping === false ? 0 : i.ship ?? 0;
  const installments = i.price * (i.installmentsPct ?? 0) / 100;
  const iibb = priceNet * (i.iibbPct ?? 0) / 100;
  // comisión y envío también traen IVA (crédito fiscal): se toman sin IVA
  const feeNet = fee / (1 + vat / 100), shipNet = ship / (1 + vat / 100), instNet = installments / (1 + vat / 100);
  const beforeCost = priceNet - feeNet - shipNet - instNet - iibb;
  const net = i.cost !== null ? beforeCost - i.cost : null;
  return {
    priceNet: r2(priceNet), fee: r2(fee), ship: r2(ship), installments: r2(installments), iibb: r2(iibb),
    beforeCost: r2(beforeCost), net: net === null ? null : r2(net),
    margin: net === null || priceNet <= 0 ? null : r2((net / priceNet) * 100),
  };
}

/** Precio final (con IVA) para lograr un margen sobre el precio sin IVA, con la misma cuenta que netPerUnit. */
export function priceForMargin(cost: number, marginPct: number, feePct = 14, shipCost = 0, iibbPct = 0, vatPct = 21) {
  const v = 1 + vatPct / 100;
  const denom = 1 - feePct / 100 - iibbPct / 100 - marginPct / 100;
  if (denom <= 0) return null;
  return r2((v * (cost + shipCost / v)) / denom);
}

// ---------------------------------------------------------------------------
// Puntaje de la cuenta (0-100), como el score de Nubimetrics
// ---------------------------------------------------------------------------
const LEVEL_SCORE: Record<string, number> = { "5_green": 100, "4_light_green": 80, "3_yellow": 55, "2_orange": 35, "1_red": 15 };
export function accountScore(p: { level: string | null; avgHealth: number | null; answeredPct: number | null; avgAnswerHours: number | null; withStockPct: number | null; competitivePct: number | null }) {
  const parts = [
    { key: "Reputación", w: 30, v: p.level ? LEVEL_SCORE[p.level] ?? 50 : 50 },
    { key: "Calidad de publicaciones", w: 25, v: p.avgHealth ?? 50 },
    { key: "Preguntas respondidas", w: 15, v: p.answeredPct ?? 100 },
    { key: "Velocidad de respuesta", w: 10, v: p.avgAnswerHours === null ? 70 : Math.max(0, Math.min(100, 100 - (p.avgAnswerHours - 1) * 8)) },
    { key: "Publicaciones con stock", w: 10, v: p.withStockPct ?? 100 },
    { key: "Precio competitivo", w: 10, v: p.competitivePct ?? 70 },
  ];
  const total = Math.round(parts.reduce((a, x) => a + x.v * x.w, 0) / parts.reduce((a, x) => a + x.w, 0));
  const worst = [...parts].sort((a, b) => a.v - b.v)[0];
  return { total, parts: parts.map((x) => ({ ...x, v: Math.round(x.v) })), worst: worst.key };
}

// ---------------------------------------------------------------------------
// Palabras clave
// ---------------------------------------------------------------------------
const STOP = new Set("de la el los las un una unos unas y o con sin para por en x al del a mas más muy su sus es que se lo le ml cm mm kg gr lt lts unidad unidades u pack".split(" "));
export const words = (s: string) => norm(s).split(" ").filter((w) => w.length > 2 && !STOP.has(w) && !/^\d+$/.test(w));

/** Palabras que la gente busca (tendencias) que no aparecen en el título. */
export function missingKeywords(title: string, searches: string[], max = 8) {
  const have = new Set(words(title));
  const count = new Map<string, number>();
  searches.forEach((q, i) => {
    for (const w of new Set(words(q))) if (!have.has(w)) count.set(w, (count.get(w) ?? 0) + (searches.length - i));
  });
  return [...count.entries()].sort((a, b) => b[1] - a[1]).slice(0, max).map(([w]) => w);
}

/** Arma un título de hasta 60 caracteres: producto + atributos clave + palabras buscadas que faltan. */
export function buildTitle(base: string, extras: string[], max = 60) {
  const cap = (w: string) => w.charAt(0).toUpperCase() + w.slice(1);
  let t = base.trim().replace(/\s+/g, " ");
  const have = new Set(words(t));
  for (const e of extras) {
    const add = e.split(" ").filter((w) => !have.has(norm(w))).map(cap).join(" ");
    if (!add) continue;
    if ((t + " " + add).length > max) continue;
    t = `${t} ${add}`;
    words(add).forEach((w) => have.add(w));
  }
  return t.slice(0, max);
}

/** Frecuencia de palabras en un conjunto de textos (preguntas, títulos de la competencia). */
export function wordFreq(texts: string[], top = 20) {
  const c = new Map<string, number>();
  for (const t of texts) for (const w of new Set(words(t))) c.set(w, (c.get(w) ?? 0) + 1);
  return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, top).map(([word, n]) => ({ word, n }));
}

// ---------------------------------------------------------------------------
// Preguntas: respuesta automática y horario
// ---------------------------------------------------------------------------
export type AutoAnswer = { id: string; name: string; keywords: string[]; answer: string; active: boolean };
/** La regla que corresponde a una pregunta (la que más palabras clave coincide). */
export function matchAnswer(question: string, rules: AutoAnswer[]) {
  const q = ` ${norm(question)} `;
  let best: { rule: AutoAnswer; hits: number } | null = null;
  for (const r of rules.filter((x) => x.active)) {
    const hits = r.keywords.filter((k) => q.includes(` ${norm(k)} `) || q.includes(` ${norm(k)}`)).length;
    if (hits && (!best || hits > best.hits)) best = { rule: r, hits };
  }
  return best?.rule ?? null;
}

/** ¿Estamos en horario de atención? (hora de Argentina) */
export function inBusinessHours(now: Date, from: number, to: number, days: number[]) {
  const ar = new Date(now.getTime() - 3 * 3600e3);
  const dow = ar.getUTCDay() === 0 ? 7 : ar.getUTCDay();
  const h = ar.getUTCHours() + ar.getUTCMinutes() / 60;
  return days.includes(dow) && h >= from && h < to;
}

/** Personaliza la respuesta (saludo con el nombre si lo hay) y respeta el máximo de ML (2000). */
export const personalize = (answer: string, name?: string | null) => (name ? answer.replace(/^Hola,?/i, `Hola ${name},`) : answer).slice(0, 2000);

// ---------------------------------------------------------------------------
// Repricing
// ---------------------------------------------------------------------------
export type PriceRule = { strategy: "win_catalog" | "match_lowest" | "cost_plus"; min_price: number; max_price: number | null; margin_pct: number | null; step: number };
/** Precio nuevo según la regla (o null si no hay que tocar). Nunca baja del piso ni sube del techo. */
export function repriceTarget(rule: PriceRule, ctx: { current: number; priceToWin: number | null; lowestCompetitor: number | null; cost: number | null; feePct?: number }) {
  let target: number | null = null;
  if (rule.strategy === "win_catalog" && ctx.priceToWin) target = ctx.priceToWin;
  if (rule.strategy === "match_lowest" && ctx.lowestCompetitor) target = ctx.lowestCompetitor - rule.step;
  if (rule.strategy === "cost_plus" && ctx.cost !== null && rule.margin_pct !== null) target = priceForMargin(ctx.cost, rule.margin_pct, ctx.feePct ?? 14);
  if (target === null) return null;
  target = Math.max(rule.min_price, target);
  if (rule.max_price) target = Math.min(rule.max_price, target);
  target = Math.round(target);
  return Math.abs(target - ctx.current) >= 1 ? target : null;
}

// ---------------------------------------------------------------------------
// Pruebas A/B
// ---------------------------------------------------------------------------
export type AbResults = { a: { days: number; visits: number; sold: number }; b: { days: number; visits: number; sold: number } };
export function abWinner(r: AbResults) {
  const conv = (x: { visits: number; sold: number }) => (x.visits ? x.sold / x.visits : 0);
  const perDay = (x: { days: number; sold: number }) => (x.days ? x.sold / x.days : 0);
  if (r.a.days < 3 || r.b.days < 3) return { winner: null as "a" | "b" | null, reason: "Faltan días para comparar" };
  const sa = perDay(r.a), sb = perDay(r.b);
  if (sa === sb) {
    const ca = conv(r.a), cb = conv(r.b);
    if (ca === cb) return { winner: null, reason: "Empate" };
    return { winner: ca > cb ? "a" as const : "b" as const, reason: "Mismas ventas, mejor conversión" };
  }
  return { winner: sa > sb ? "a" as const : "b" as const, reason: `Vende ${Math.round(Math.abs(sa - sb) / Math.max(sa, sb, 0.0001) * 100)} % más por día` };
}

// ---------------------------------------------------------------------------
// Stock y ventas
// ---------------------------------------------------------------------------
/** Días hasta quedarte sin stock con el ritmo de ventas de los últimos 30 días. */
export const daysOfStock = (available: number, sold30: number) => (sold30 > 0 ? Math.floor(available / (sold30 / 30)) : null);

/** Publicaciones parecidas entre sí (posible canibalización): mismas palabras principales. */
export function duplicates(items: { id: string; title: string; status: string }[], threshold = 0.8) {
  const sets = items.map((i) => ({ ...i, w: new Set(words(i.title)) }));
  const out: { a: string; b: string; score: number }[] = [];
  for (let i = 0; i < sets.length; i++) for (let j = i + 1; j < sets.length; j++) {
    const A = sets[i].w, B = sets[j].w;
    if (!A.size || !B.size) continue;
    const inter = [...A].filter((x) => B.has(x)).length;
    const score = inter / Math.min(A.size, B.size);
    if (score >= threshold) out.push({ a: sets[i].id, b: sets[j].id, score: r2(score) });
  }
  return out;
}

/** Conversión (ventas / visitas) en %. */
export const conversion = (sold: number, visits: number) => (visits > 0 ? r2((sold / visits) * 100) : null);

// ---------------------------------------------------------------------------
// Calendario comercial (Argentina)
// ---------------------------------------------------------------------------
const nthWeekday = (y: number, m: number, dow: number, n: number) => {
  const d = new Date(Date.UTC(y, m - 1, 1));
  const shift = (dow - d.getUTCDay() + 7) % 7;
  return new Date(Date.UTC(y, m - 1, 1 + shift + (n - 1) * 7)).toISOString().slice(0, 10);
};
const lastWeekday = (y: number, m: number, dow: number) => {
  const d = new Date(Date.UTC(y, m, 0));
  const shift = (d.getUTCDay() - dow + 7) % 7;
  return new Date(Date.UTC(y, m - 1, d.getUTCDate() - shift)).toISOString().slice(0, 10);
};
/** Fechas comerciales del año (las de ML son aproximadas: se confirman cerca de la fecha). */
export function commercialCalendar(y: number) {
  return [
    { date: `${y}-02-14`, name: "San Valentín" },
    { date: `${y}-03-01`, name: "Vuelta a clases" },
    { date: nthWeekday(y, 5, 1, 2), name: "Hot Sale (aprox.)" },
    { date: nthWeekday(y, 6, 0, 3), name: "Día del Padre" },
    { date: `${y}-07-20`, name: "Día del Amigo" },
    { date: nthWeekday(y, 8, 0, 3), name: "Día del Niño" },
    { date: nthWeekday(y, 10, 0, 3), name: "Día de la Madre" },
    { date: nthWeekday(y, 11, 1, 1), name: "CyberMonday (aprox.)" },
    { date: lastWeekday(y, 11, 5), name: "Black Friday" },
    { date: `${y}-12-24`, name: "Navidad" },
  ].sort((a, b) => a.date.localeCompare(b.date));
}
export function nextEvents(today: string, n = 3) {
  const y = Number(today.slice(0, 4));
  return [...commercialCalendar(y), ...commercialCalendar(y + 1)].filter((e) => e.date >= today).slice(0, n)
    .map((e) => ({ ...e, days: Math.round((Date.parse(e.date) - Date.parse(today)) / 864e5) }));
}

// ---------------------------------------------------------------------------
// Precios por cantidad (mayorista)
// ---------------------------------------------------------------------------
/** Escalones de descuento por cantidad a partir de un % máximo (ej. 2u 3%, 5u 5%, 10u 8%). */
export function quantityTiers(maxPct: number) {
  const steps = [{ min: 2, f: 0.35 }, { min: 5, f: 0.6 }, { min: 10, f: 0.8 }, { min: 25, f: 1 }];
  return steps.map((s) => ({ min: s.min, pct: r2(maxPct * s.f) }));
}

// ---------------------------------------------------------------------------
// Estado de la venta para el panel del día
// ---------------------------------------------------------------------------
export function saleStage(o: { status: string; shipStatus: string | null; shipSub: string | null; handlingLimit: string | null }, now = new Date()) {
  if (o.status === "cancelled") return { key: "cancelada", label: "Cancelada", tone: "neutral" as const };
  if (o.shipStatus === "delivered") return { key: "entregada", label: "Entregada", tone: "accent" as const };
  if (o.shipStatus === "shipped") return { key: "en_camino", label: "En camino", tone: "info" as const };
  if (o.shipStatus === "ready_to_ship" || o.shipStatus === "handling" || o.shipStatus === "pending") {
    const late = o.handlingLimit && Date.parse(o.handlingLimit) < now.getTime();
    const soon = o.handlingLimit && Date.parse(o.handlingLimit) - now.getTime() < 24 * 3600e3;
    if (o.shipSub === "printed") return { key: "despachar", label: late ? "Despachar YA (demorada)" : "Impresa, falta despachar", tone: late ? "danger" as const : "warn" as const };
    return { key: "preparar", label: late ? "Demorada: preparar YA" : soon ? "Preparar hoy" : "Preparar", tone: late ? "danger" as const : soon ? "warn" as const : "info" as const };
  }
  if (!o.shipStatus) return { key: "acordar", label: "Acordar entrega", tone: "warn" as const };
  return { key: "otro", label: o.shipStatus, tone: "neutral" as const };
}
