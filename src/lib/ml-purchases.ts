/** Compras en Mercado Libre: rubros, IVA, percepciones, envíos, vendedores y duplicados. */

export type MlOrder = {
  id: string; title: string; quantity: string | null; total_amount: string | null; counterpart: string | null; status: string;
  ordered_at: string | null; delivered_at: string | null; eta: string | null; invoice_available: boolean | null; created_at: string;
};
export type MlInvoice = {
  id: string; mail_subject: string | null; supplier_name: string | null; letter: string | null; total: string | null; net: string | null;
  issue_date: string | null; vat: number | null; other_taxes: number | null; items: string[];
};
export type MlReturn = { id: string; title: string; stage: string; start_deadline: string | null; ship_deadline: string | null; protected_until: string | null; refunded_at: string | null; ml_order_id: string | null; bank_movement_id: string | null };

export const RUBROS: { key: string; label: string; re: RegExp }[] = [
  { key: "limpieza", label: "Limpieza e higiene", re: /lavandin|deterg|jab[oó]n|desinfect|trapo|escoba|secador|limpi|papel higi|toalla|rollo de cocina|esponja|cloro|alcohol|guante/i },
  { key: "embalaje", label: "Embalaje", re: /cinta (de )?embal|film|stretch|caja|bolsa|precinto|etiqueta|burbuja|cart[oó]n|sobre|zuncho|embal/i },
  { key: "oficina", label: "Oficina", re: /resma|papel a4|tinta|t[oó]ner|birome|lapicer|carpeta|abrochad|silla|sill[oó]n|escritorio|impresora|cuaderno|archivo/i },
  { key: "ferreteria", label: "Ferretería y electricidad", re: /taladro|destornill|pistola|tornillo|mecha|llave|cable|foco|led|enchufe|ferret|herramient|candado|pegamento|silicona|estante|m[eé]nsula|plaf[oó]n|velador|l[aá]mpara/i },
  { key: "vehiculo", label: "Camioneta y repuestos", re: /repuesto|filtro|aceite|cubierta|neum[aá]tic|sprinter|mercedes|bater[ií]a de auto|escobilla|l[aá]mpara h7|amortiguad|pastilla de freno/i },
  { key: "electronica", label: "Electrónica y sonido", re: /micr[oó]fono|parlante|auricular|celular|cargador|notebook|pendrive|xlr|plug|audio|mouse|teclado|monitor|router/i },
  { key: "bazar", label: "Bazar y cocina", re: /sart[eé]n|olla|bandeja|rallador|vaso|plato|cubierto|termo|jarra|taza|conservadora|termotanque/i },
];
export const rubroOf = (title: string) => RUBROS.find((r) => r.re.test(title))?.key ?? "otros";
export const rubroLabel = (k: string) => RUBROS.find((r) => r.key === k)?.label ?? (k === "envios" ? "Envíos" : "Otros");

export const norm = (s: string) => s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();
const day = (iso: string | null) => (iso ? iso.slice(0, 10) : null);
const days = (a: string, b: string) => Math.round((Date.parse(b) - Date.parse(a)) / 864e5);

/** Busca la factura del vendedor de cada compra (por el producto y la fecha). */
export function matchInvoices(orders: MlOrder[], invoices: MlInvoice[]) {
  const used = new Set<string>();
  const by = new Map<string, MlInvoice>();
  for (const o of [...orders].sort((a, b) => (a.ordered_at ?? "").localeCompare(b.ordered_at ?? ""))) {
    const key = norm(o.title).slice(0, 25);
    const od = o.ordered_at ?? o.created_at;
    const inv = invoices.find((i) => !used.has(i.id) && i.mail_subject && norm(i.mail_subject).startsWith(key) && i.issue_date && Math.abs(days(od, i.issue_date)) <= 20);
    if (inv) { used.add(inv.id); by.set(o.id, inv); }
  }
  return by;
}

export type MlSummary = ReturnType<typeof summarize>;

export function summarize(orders: MlOrder[], invoices: MlInvoice[]) {
  const inv = matchInvoices(orders, invoices);
  const rows = orders.map((o) => {
    const total = Number(o.total_amount ?? 0);
    const i = inv.get(o.id);
    const letterA = i?.letter === "A";
    const vat = i && letterA ? (i.vat ?? Math.max(0, Number(i.total ?? 0) - Number(i.net ?? 0))) : 0;
    const perc = i && letterA ? Number(i.other_taxes ?? 0) : 0;
    // envío: lo que la factura cobró por encima del producto (o un renglón "envío")
    const shipItems = i?.items.some((t) => /env[ií]o/i.test(t)) ?? false;
    const ship = i && Number(i.total ?? 0) > total && Number(i.total ?? 0) - total < total * 0.4 ? Number(i.total) - total : 0;
    return {
      o, total, inv: i ?? null, letter: i?.letter ?? null, vat, perc, ship: shipItems || ship > 0 ? ship : 0,
      lostVat: !i || !letterA ? Math.round((total * 21) / 121 * 100) / 100 : 0, rubro: rubroOf(o.title),
    };
  });
  const sum = (f: (r: (typeof rows)[number]) => number) => rows.reduce((a, r) => a + f(r), 0);
  const byRubro = new Map<string, { total: number; n: number }>();
  for (const r of rows) { const x = byRubro.get(r.rubro) ?? { total: 0, n: 0 }; x.total += r.total; x.n++; byRubro.set(r.rubro, x); }
  const shipping = sum((r) => r.ship);
  if (shipping > 0) byRubro.set("envios", { total: shipping, n: rows.filter((r) => r.ship > 0).length });
  return {
    rows,
    total: sum((r) => r.total), n: rows.length,
    vat: sum((r) => r.vat), lostVat: sum((r) => r.lostVat), perc: sum((r) => r.perc), shipping,
    withA: rows.filter((r) => r.letter === "A").length, noInvoice: rows.filter((r) => !r.inv).length,
    byRubro: [...byRubro].sort((a, b) => b[1].total - a[1].total),
  };
}

/** Misma compra repetida: mismo producto, mismo vendedor, mismo día. */
export function duplicates(orders: MlOrder[]) {
  const g = new Map<string, MlOrder[]>();
  for (const o of orders) {
    const k = `${norm(o.title)}|${(o.counterpart ?? "").toLowerCase()}|${day(o.ordered_at ?? o.created_at)}`;
    g.set(k, [...(g.get(k) ?? []), o]);
  }
  return [...g.values()].filter((l) => l.length > 1);
}

/** Puntaje de cada vendedor: demora en entregar, devoluciones y si manda factura. */
export function sellers(orders: MlOrder[], returns: MlReturn[], invByOrder: Map<string, MlInvoice>) {
  const retBy = new Set(returns.map((r) => r.ml_order_id).filter(Boolean) as string[]);
  const m = new Map<string, { name: string; n: number; total: number; delays: number[]; returns: number; invoiced: number; invA: number }>();
  for (const o of orders) {
    const name = o.counterpart?.trim() || "Sin vendedor";
    const x = m.get(name) ?? { name, n: 0, total: 0, delays: [], returns: 0, invoiced: 0, invA: 0 };
    x.n++; x.total += Number(o.total_amount ?? 0);
    if (o.delivered_at && o.ordered_at) x.delays.push(Math.max(0, days(o.ordered_at, o.delivered_at)));
    if (retBy.has(o.id)) x.returns++;
    const i = invByOrder.get(o.id);
    if (i || o.invoice_available) x.invoiced++;
    if (i?.letter === "A") x.invA++;
    m.set(name, x);
  }
  return [...m.values()].map((x) => {
    const avgDelay = x.delays.length ? Math.round((x.delays.reduce((a, b) => a + b, 0) / x.delays.length) * 10) / 10 : null;
    const invRate = x.invoiced / x.n, retRate = x.returns / x.n;
    const score = Math.round(Math.max(0, Math.min(100, 100 - (avgDelay ? Math.max(0, avgDelay - 2) * 6 : 0) - retRate * 60 - (1 - invRate) * 30)));
    return { ...x, avgDelay, invRate, retRate, score };
  }).sort((a, b) => b.total - a.total);
}
