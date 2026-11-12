import "server-only";
import { createHash, randomBytes } from "node:crypto";

/**
 * Conexión directa con la API de Mercado Libre usando la aplicación propia de la empresa.
 * Trae compras (como comprador) y ventas (como vendedor) con precios y comisiones.
 */
export const ML_AUTH = "https://auth.mercadolibre.com.ar/authorization";
const API = "https://api.mercadolibre.com";

export const mlRedirectUri = (origin: string) => `${origin}/api/ml/callback`;
const b64url = (b: Buffer) => b.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
export function pkcePair() {
  const verifier = b64url(randomBytes(48));
  return { verifier, challenge: b64url(createHash("sha256").update(verifier).digest()), state: b64url(randomBytes(18)) };
}

type Tokens = { access_token: string; refresh_token: string; expires_in: number; user_id: number };

async function tokenRequest(body: Record<string, string>): Promise<Tokens> {
  const r = await fetch(`${API}/oauth/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded", accept: "application/json" },
    body: new URLSearchParams(body),
    cache: "no-store",
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.access_token) throw new Error(`Mercado Libre rechazó el acceso: ${j.message ?? j.error ?? r.status}`);
  return j as Tokens;
}

export const exchangeCode = (p: { client_id: string; client_secret: string; code: string; redirect_uri: string; verifier?: string | null }) =>
  tokenRequest({ grant_type: "authorization_code", client_id: p.client_id, client_secret: p.client_secret, code: p.code, redirect_uri: p.redirect_uri, ...(p.verifier ? { code_verifier: p.verifier } : {}) });

const refresh = (p: { client_id: string; client_secret: string; refresh_token: string }) =>
  tokenRequest({ grant_type: "refresh_token", client_id: p.client_id, client_secret: p.client_secret, refresh_token: p.refresh_token });

async function get<T>(path: string, token: string): Promise<T> {
  const r = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${token}` }, cache: "no-store" });
  if (!r.ok) {
    const j = await r.json().catch(() => ({}));
    throw new Error(`Mercado Libre ${r.status}: ${j.message ?? j.error ?? path}`);
  }
  return r.json() as Promise<T>;
}

export const getMe = (token: string) => get<{ id: number; nickname: string }>("/users/me", token);

type ApiOrder = {
  id: number; pack_id: number | null; date_created: string; status: string; total_amount: number; paid_amount?: number; tags?: string[];
  order_items: { item: { title: string }; quantity: number; unit_price: number; sale_fee?: number }[];
  buyer?: { nickname?: string }; seller?: { nickname?: string };
};
export type MlApiOrder = {
  kind: "compra" | "venta"; order_id: string; pack_id: string | null; date: string; status: string; total: string;
  fees: string | null; delivered: boolean; counterpart: string | null; items: { title: string; quantity: number; unit_price: number }[];
};

export function mapOrder(o: ApiOrder, kind: "compra" | "venta"): MlApiOrder {
  const fees = kind === "venta" ? o.order_items.reduce((a, i) => a + (i.sale_fee ?? 0) * i.quantity, 0) : 0;
  return {
    kind, order_id: String(o.id), pack_id: o.pack_id ? String(o.pack_id) : null, date: o.date_created, status: o.status,
    total: String(o.total_amount ?? o.paid_amount ?? 0), fees: fees ? fees.toFixed(2) : null,
    delivered: (o.tags ?? []).includes("delivered"),
    counterpart: (kind === "compra" ? o.seller?.nickname : o.buyer?.nickname) ?? null,
    items: o.order_items.map((i) => ({ title: i.item.title, quantity: i.quantity, unit_price: i.unit_price })),
  };
}

/** Une las órdenes de un mismo carrito (pack) en una sola operación, como la muestra Mercado Libre. */
export function groupPacks(list: MlApiOrder[]): MlApiOrder[] {
  const out = new Map<string, MlApiOrder>();
  for (const o of list) {
    const k = `${o.kind}:${o.pack_id ?? o.order_id}`;
    const prev = out.get(k);
    if (!prev) { out.set(k, { ...o, items: [...o.items] }); continue; }
    prev.items.push(...o.items);
    prev.total = (Number(prev.total) + Number(o.total)).toFixed(2);
    if (o.fees) prev.fees = (Number(prev.fees ?? 0) + Number(o.fees)).toFixed(2);
    prev.delivered = prev.delivered && o.delivered;
    if (o.date < prev.date) prev.date = o.date;
  }
  return [...out.values()];
}

async function listOrders(token: string, role: "buyer" | "seller", userId: number, since: Date) {
  const res: ApiOrder[] = [];
  for (let offset = 0; offset < 2000; offset += 50) {
    const page = await get<{ results: ApiOrder[]; paging: { total: number } }>(
      `/orders/search?${role}=${userId}&sort=date_desc&limit=50&offset=${offset}`, token);
    res.push(...page.results);
    const last = page.results[page.results.length - 1];
    if (!last || page.results.length < 50 || new Date(last.date_created) < since || offset + 50 >= page.paging.total) break;
  }
  return res.filter((o) => new Date(o.date_created) >= since);
}

export type MlRpc = (action: string, data?: Record<string, unknown>) => Promise<Record<string, unknown>>;

/** Token vigente (lo refresca si hace falta) y el usuario de Mercado Libre. */
async function mlToken(rpc: MlRpc, c?: Record<string, unknown>) {
  c = c ?? (await rpc("creds"));
  if (!c.connected) {
    if (c.expired) throw new Error("La conexión con Mercado Libre venció. Activá \"Acceso offline\" (offline_access) en tu aplicación de ML y tocá Conectar de nuevo");
    return null;
  }
  let token = String(c.access_token ?? "");
  let userId = Number(c.ml_user_id ?? 0);
  if (c.refresh_token && (!token || !c.expires_at || new Date(String(c.expires_at)).getTime() < Date.now() + 5 * 60_000)) {
    const t = await refresh({ client_id: String(c.client_id), client_secret: String(c.client_secret), refresh_token: String(c.refresh_token) });
    token = t.access_token;
    userId = t.user_id || userId;
    await rpc("save_tokens", { access_token: t.access_token, refresh_token: t.refresh_token, expires_at: new Date(Date.now() + t.expires_in * 1000).toISOString(), ml_user_id: userId });
  }
  if (!userId) {
    const me = await getMe(token);
    userId = me.id;
    await rpc("save_tokens", { ml_user_id: me.id, nickname: me.nickname });
  }
  return { token, userId, c };
}

/** Sincroniza: refresca el token si hace falta, trae compras y ventas desde la última vez y las aplica. */
export async function syncMercadoLibre(rpc: MlRpc) {
  const c = await rpc("creds");
  if (!c.connected && !c.expired) return { connected: false as const };
  try {
    const t = await mlToken(rpc, c);
    if (!t) return { connected: false as const };
    const { token, userId } = t;
    const since = c.last_sync_at ? new Date(new Date(String(c.last_sync_at)).getTime() - 3 * 864e5) : new Date(Date.now() - 185 * 864e5);
    const [buys, sells] = await Promise.all([listOrders(token, "buyer", userId, since), listOrders(token, "seller", userId, since)]);
    const orders = groupPacks([...buys.map((o) => mapOrder(o, "compra")), ...sells.map((o) => mapOrder(o, "venta"))]);
    const r = await rpc("apply", { orders });
    return { connected: true as const, ...r, leidas: orders.length };
  } catch (e) {
    await rpc("error", { message: (e as Error).message }).catch(() => null);
    throw e;
  }
}

async function send(method: "PUT", path: string, token: string, body: unknown) {
  const r = await fetch(`${API}${path}`, { method, headers: { authorization: `Bearer ${token}`, "content-type": "application/json" }, body: JSON.stringify(body), cache: "no-store" });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Mercado Libre ${r.status}: ${j.message ?? j.error ?? path}${j.cause?.[0]?.message ? ` (${j.cause[0].message})` : ""}`);
  return j;
}

type Rule = { enabled: boolean; min: number; target: number };
type MlItem = { id: string; title: string; available_quantity: number; sold_quantity: number; price: number; status: string; permalink: string; thumbnail: string;
  shipping?: { logistic_type?: string }; variations?: { id: number; available_quantity: number }[] };

/**
 * Repone el stock de las publicaciones: si la cantidad disponible bajó del mínimo, la vuelve a dejar en el objetivo
 * (ej. "siempre 10"). No toca publicaciones de Full (el stock lo maneja Mercado Libre) ni las pausadas.
 */
export async function restockMercadoLibre(rpc: MlRpc, stock: MlRpc) {
  const rules = await stock("rules") as { default: Rule | null; items: Record<string, Rule> };
  const t = await mlToken(rpc);
  if (!t) return { connected: false as const };
  const ids: string[] = [];
  for (let offset = 0; offset < 1000; offset += 100) {
    const page = await get<{ results: string[]; paging: { total: number } }>(`/users/${t.userId}/items/search?status=active&limit=100&offset=${offset}`, t.token);
    ids.push(...page.results);
    if (page.results.length < 100 || offset + 100 >= page.paging.total) break;
  }
  const out: Record<string, unknown>[] = [];
  let restocked = 0;
  for (let i = 0; i < ids.length; i += 20) {
    const batch = await get<{ code: number; body: MlItem }[]>(`/items?ids=${ids.slice(i, i + 20).join(",")}&attributes=id,title,available_quantity,sold_quantity,price,status,permalink,thumbnail,shipping,variations`, t.token);
    for (const { body: it } of batch.filter((b) => b.code === 200)) {
      const rule = rules.items[it.id] ?? rules.default;
      const row: Record<string, unknown> = { id: it.id, title: it.title, available: it.available_quantity, sold: it.sold_quantity, price: it.price, status: it.status,
        logistic: it.shipping?.logistic_type ?? null, permalink: it.permalink, thumbnail: it.thumbnail, variations: it.variations?.length ?? 0 };
      if (rule?.enabled && it.status === "active" && it.shipping?.logistic_type !== "fulfillment") {
        try {
          if (it.variations?.length) {
            const low = it.variations.some((v) => v.available_quantity < rule.min);
            if (low) {
              await send("PUT", `/items/${it.id}`, t.token, { variations: it.variations.map((v) => ({ id: v.id, available_quantity: v.available_quantity < rule.min ? rule.target : v.available_quantity })) });
              row.restocked = rule.target; restocked++;
            }
          } else if (it.available_quantity < rule.min) {
            await send("PUT", `/items/${it.id}`, t.token, { available_quantity: rule.target });
            row.available = rule.target; row.restocked = rule.target; restocked++;
          }
        } catch (e) { row.error = (e as Error).message; }
      }
      out.push(row);
    }
  }
  await stock("snapshot", { items: out, complete: true });
  return { connected: true as const, items: out.length, restocked };
}

/**
 * Baja las facturas que suben los vendedores a cada compra (PDF), las lee y las guarda en Precios de proveedores.
 * `parse` recibe el PDF y devuelve los datos de la factura (se pasa desde afuera para no cargar el lector acá).
 */
export async function fetchMlInvoices(rpc: MlRpc, stock: MlRpc, parse: (pdf: Uint8Array, filename: string) => Promise<Record<string, unknown> | null>, limit = 20) {
  const targets = (await stock("invoice_targets", { limit })) as unknown as { id: string; ids: string[]; title: string; seller: string | null }[];
  if (!Array.isArray(targets) || !targets.length) return { checked: 0, saved: 0 };
  const t = await mlToken(rpc);
  if (!t) return { checked: 0, saved: 0 };
  const done: string[] = [], checked: string[] = [];
  let saved = 0;
  for (const o of targets) {
    let docs: { pack: string; list: { id: string; file_type?: string; filename?: string }[] } | null = null;
    for (const pack of [...o.ids].reverse()) {
      const r = await fetch(`${API}/packs/${pack}/fiscal_documents`, { headers: { authorization: `Bearer ${t.token}` }, cache: "no-store" });
      if (r.status === 404) continue;
      if (!r.ok) break;
      const j = await r.json().catch(() => ({}));
      docs = { pack, list: j.fiscal_documents ?? [] };
      break;
    }
    if (!docs) { done.push(o.id); continue; }
    if (!docs.list.length) { checked.push(o.id); continue; } // el vendedor todavía no la subió: se vuelve a mirar en 12 horas
    for (const d of docs.list.slice(0, 3)) {
      if (d.file_type && !/pdf/i.test(d.file_type) && !/\.pdf$/i.test(d.filename ?? "")) continue;
      const r = await fetch(`${API}/packs/${docs.pack}/fiscal_documents/${d.id}`, { headers: { authorization: `Bearer ${t.token}` }, cache: "no-store" });
      if (!r.ok) continue;
      const bytes = new Uint8Array(await r.arrayBuffer());
      if (bytes.length > 6_000_000 || Buffer.from(bytes.slice(0, 5)).toString() !== "%PDF-") continue;
      const inv = await parse(bytes, d.filename ?? `${d.id}.pdf`).catch(() => null);
      if (!inv) continue;
      const res = await stock("store_invoice", { ...inv, mail_id: `ml:${d.id}`, supplier_hint: o.seller ?? "Mercado Libre", mail_subject: o.title });
      if (res.result === "nueva") saved++;
    }
    done.push(o.id);
  }
  if (done.length || checked.length) await stock("invoice_done", { ids: done, checked });
  return { checked: targets.length, saved };
}
