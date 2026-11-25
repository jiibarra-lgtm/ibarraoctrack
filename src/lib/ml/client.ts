import "server-only";
import { mlToken, type MlRpc } from "@/lib/ml-api";

/**
 * Cliente de la API de Mercado Libre con el token de la cuenta conectada (se renueva solo).
 * Todas las llamadas devuelven { ok, status, data } y nunca tiran error por un 4xx: la pantalla decide qué mostrar.
 */
const API = "https://api.mercadolibre.com";

export type MlRes<T> = { ok: boolean; status: number; data: T; error?: string };

export type Ml = {
  userId: number;
  get: <T = unknown>(path: string) => Promise<MlRes<T>>;
  post: <T = unknown>(path: string, body: unknown) => Promise<MlRes<T>>;
  put: <T = unknown>(path: string, body: unknown) => Promise<MlRes<T>>;
  del: <T = unknown>(path: string) => Promise<MlRes<T>>;
  raw: (path: string, init?: RequestInit) => Promise<Response>;
};

const errText = (j: { message?: string; error?: string; cause?: { message?: string }[] } | null, status: number) =>
  `${j?.message ?? j?.error ?? `Error ${status}`}${j?.cause?.[0]?.message ? ` (${j.cause[0].message})` : ""}`;

export async function mlClient(rpc: MlRpc): Promise<Ml | null> {
  const t = await mlToken(rpc).catch(() => null);
  if (!t) return null;
  const call = async <T,>(method: string, path: string, body?: unknown): Promise<MlRes<T>> => {
    try {
      const r = await fetch(`${API}${path}`, {
        method, cache: "no-store",
        headers: { authorization: `Bearer ${t.token}`, ...(body !== undefined ? { "content-type": "application/json" } : {}), accept: "application/json" },
        body: body !== undefined ? JSON.stringify(body) : undefined,
      });
      const j = await r.json().catch(() => null);
      return { ok: r.ok, status: r.status, data: j as T, error: r.ok ? undefined : errText(j, r.status) };
    } catch (e) {
      return { ok: false, status: 0, data: null as T, error: (e as Error).message };
    }
  };
  return {
    userId: t.userId,
    get: (p) => call("GET", p),
    post: (p, b) => call("POST", p, b),
    put: (p, b) => call("PUT", p, b),
    del: (p) => call("DELETE", p),
    raw: (p, init) => fetch(`${API}${p}`, { ...init, cache: "no-store", headers: { authorization: `Bearer ${t.token}`, ...(init?.headers ?? {}) } }),
  };
}

/** Pide varias cosas en paralelo pero de a pocas (la API limita). */
export async function pool<T, R>(list: T[], n: number, fn: (x: T) => Promise<R>): Promise<R[]> {
  const out: R[] = new Array(list.length);
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, list.length) }, async () => {
    while (i < list.length) { const k = i++; out[k] = await fn(list[k]); }
  }));
  return out;
}

// --- Tipos de la API (sólo lo que usamos) ---------------------------------
export type ApiItem = {
  id: string; title: string; price: number; base_price?: number; original_price?: number | null; currency_id: string;
  available_quantity: number; sold_quantity: number; initial_quantity?: number; status: string; sub_status?: string[];
  category_id: string; listing_type_id: string; condition: string; permalink: string; thumbnail: string;
  pictures?: { id: string; secure_url: string; size?: string; max_size?: string }[];
  attributes?: { id: string; name: string; value_id?: string | null; value_name?: string | null }[];
  variations?: { id: number; available_quantity: number; sold_quantity?: number; price: number; attribute_combinations?: { name: string; value_name: string }[] }[];
  shipping?: { mode?: string; free_shipping?: boolean; logistic_type?: string; tags?: string[] };
  catalog_listing?: boolean; catalog_product_id?: string | null; date_created?: string; last_updated?: string; tags?: string[];
  sale_terms?: { id: string; value_name: string | null }[]; user_product_id?: string; health?: number | null;
  seller_id?: number; video_id?: string | null;
};

export type ApiPerformance = {
  score: number; level: string;
  buckets?: { title: string; score: number; variables?: { title: string; status: string; score: number; rules?: { status: string; mode?: string; wordings?: { title?: string; label?: string; link?: string } }[] }[] }[];
};

export type ApiOrder = {
  id: number; pack_id: number | null; date_created: string; date_closed?: string; status: string; total_amount: number; paid_amount?: number;
  tags?: string[]; shipping?: { id: number | null }; buyer?: { id: number; nickname?: string };
  order_items: { item: { id: string; title: string; category_id?: string; variation_id?: number | null }; quantity: number; unit_price: number; sale_fee?: number }[];
  payments?: { installments?: number; payment_type?: string; total_paid_amount?: number; shipping_cost?: number; taxes_amount?: number; date_approved?: string }[];
  feedback?: { buyer?: unknown; seller?: unknown };
};

export type ApiShipment = {
  id: number; status: string; substatus?: string | null; logistic_type?: string; mode?: string; date_created?: string;
  receiver_address?: { state?: { id?: string; name?: string }; city?: { name?: string }; zip_code?: string };
  shipping_option?: { cost?: number; list_cost?: number; estimated_delivery_time?: { date?: string } };
  lead_time?: { cost?: number; list_cost?: number; estimated_delivery_time?: { date?: string }; estimated_handling_limit?: { date?: string } };
  status_history?: { date_shipped?: string | null; date_delivered?: string | null };
};
