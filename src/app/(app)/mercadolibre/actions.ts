"use server";
import { revalidatePath } from "next/cache";
import { requireOrg, canWrite } from "@/lib/session";
import { friendlyDbError } from "@/lib/errors";
import { parseArNumber } from "@/lib/money";
import { isUuid } from "@/lib/utils";

type R = { ok: true } | { ok: false; error: string };
export type MlSuggestion = { po_item_id: string; purchase_order_id: string; bac_number: string; line_number: number; description: string; quantity: string; unit_price: string; customer_name: string | null; score: string };

const done = (poId?: string | null): R => {
  revalidatePath("/mercadolibre");
  if (poId) revalidatePath(`/ordenes/${poId}`);
  return { ok: true };
};

async function guard(id: string) {
  const s = await requireOrg();
  if (!canWrite(s.org.role)) return { s, error: "No tenés permiso para modificar" };
  if (!isUuid(id)) return { s, error: "Operación inválida" };
  return { s, error: null };
}

/** Precio pagado en una compra (el mail de Mercado Libre no lo trae). Acepta "12.500,50". */
export async function setMlPrice(id: string, unit: string): Promise<R> {
  const { s, error } = await guard(id);
  if (error) return { ok: false, error };
  const v = unit.trim() ? parseArNumber(unit) : null;
  if (unit.trim() && (v === null || Number(v) < 0)) return { ok: false, error: "Precio inválido" };
  const { data, error: e } = await s.supabase.from("ml_orders").update({ unit_price: v }).eq("id", id).eq("org_id", s.org.org_id).select("purchase_order_id").maybeSingle();
  if (e) return { ok: false, error: friendlyDbError(e) };
  return done(data?.purchase_order_id);
}

export async function mlSuggestions(id: string): Promise<MlSuggestion[]> {
  const s = await requireOrg();
  if (!isUuid(id)) return [];
  const { data } = await s.supabase.rpc("ml_link_suggestions", { p_ml: id });
  return (data ?? []) as MlSuggestion[];
}

export async function linkMl(id: string, poItemId: string): Promise<R> {
  const { s, error } = await guard(id);
  if (error) return { ok: false, error };
  if (!isUuid(poItemId)) return { ok: false, error: "Renglón inválido" };
  const { data: item } = await s.supabase.from("purchase_order_items").select("purchase_order_id").eq("id", poItemId).eq("org_id", s.org.org_id).maybeSingle();
  if (!item) return { ok: false, error: "No encontré ese renglón" };
  const { error: e } = await s.supabase.from("ml_orders")
    .update({ po_item_id: poItemId, purchase_order_id: item.purchase_order_id, link_source: "manual", link_score: null, no_link: false })
    .eq("id", id).eq("org_id", s.org.org_id);
  if (e) return { ok: false, error: friendlyDbError(e) };
  return done(item.purchase_order_id);
}

/** Desvincula y no la vuelve a vincular sola. */
export async function unlinkMl(id: string): Promise<R> {
  const { s, error } = await guard(id);
  if (error) return { ok: false, error };
  const { data: prev } = await s.supabase.from("ml_orders").select("purchase_order_id").eq("id", id).maybeSingle();
  const { error: e } = await s.supabase.from("ml_orders")
    .update({ po_item_id: null, purchase_order_id: null, link_source: null, link_score: null, no_link: true })
    .eq("id", id).eq("org_id", s.org.org_id);
  if (e) return { ok: false, error: friendlyDbError(e) };
  return done(prev?.purchase_order_id);
}

// ---------------------------------------------------------------------------
// Checker de facturas de compras
// ---------------------------------------------------------------------------
export type InvoiceCandidate = { id: string; supplier_name: string | null; letter: string | null; point_of_sale: number | null; number: number | null; total: string | null; issue_date: string | null; source: string; items: string | null };

/** Facturas de proveedores sin vincular que pueden ser de esta compra (por fecha e importe), o las que coinciden con lo buscado. */
export async function invoiceCandidates(orderId: string, q: string): Promise<InvoiceCandidate[]> {
  const s = await requireOrg();
  if (!isUuid(orderId)) return [];
  const { data: o } = await s.supabase.from("ml_orders").select("total_amount, ordered_at, created_at").eq("id", orderId).eq("org_id", s.org.org_id).maybeSingle();
  if (!o) return [];
  const at = Date.parse((o.ordered_at ?? o.created_at) as string);
  const from = new Date(at - 10 * 864e5).toISOString().slice(0, 10), to = new Date(at + 60 * 864e5).toISOString().slice(0, 10);
  const { data: used } = await s.supabase.from("ml_orders").select("invoice_id").eq("org_id", s.org.org_id).not("invoice_id", "is", null);
  const taken = new Set((used ?? []).map((u) => u.invoice_id as string));
  let qb = s.supabase.from("supplier_invoices").select("id, supplier_name, letter, point_of_sale, number, total, issue_date, source, supplier_invoice_items(description)")
    .eq("org_id", s.org.org_id).eq("hidden", false);
  const needle = q.trim().replace(/[%,()]/g, " ").slice(0, 60);
  const num = Number(needle.replace(/\./g, "").replace(",", "."));
  if (needle && Number.isFinite(num) && num > 0) qb = qb.or(`number.eq.${Math.trunc(num)},and(total.gte.${num * 0.98},total.lte.${num * 1.02})`);
  else if (needle) qb = qb.ilike("supplier_name", `%${needle}%`);
  else qb = qb.gte("issue_date", from).lte("issue_date", to);
  const { data } = await qb.order("issue_date", { ascending: false }).limit(200);
  const total = Number(o.total_amount ?? 0);
  return ((data ?? []) as (Omit<InvoiceCandidate, "items"> & { supplier_invoice_items: { description: string | null }[] })[])
    .filter((i) => !taken.has(i.id))
    .map((i) => ({ ...i, items: i.supplier_invoice_items.map((x) => x.description).filter(Boolean).join(" · ").slice(0, 140) || null }))
    .sort((a, b) => (total ? Math.abs(Number(a.total ?? 0) - total) - Math.abs(Number(b.total ?? 0) - total) : 0))
    .slice(0, 25);
}

export async function linkInvoice(orderId: string, invoiceId: string | null): Promise<R> {
  const { s, error } = await guard(orderId);
  if (error) return { ok: false, error };
  if (invoiceId !== null && !isUuid(invoiceId)) return { ok: false, error: "Factura inválida" };
  const { error: e } = await s.supabase.from("ml_orders")
    .update(invoiceId ? { invoice_id: invoiceId, invoice_link: "manual", invoice_none: false } : { invoice_id: null, invoice_link: null })
    .eq("id", orderId).eq("org_id", s.org.org_id);
  if (e) return { ok: false, error: e.code === "23505" ? "Esa factura ya está vinculada a otra compra" : friendlyDbError(e) };
  return done();
}

/** "Esta compra no lleva factura" (o volver a buscarla). */
export async function setNoInvoice(orderId: string, none: boolean): Promise<R> {
  const { s, error } = await guard(orderId);
  if (error) return { ok: false, error };
  const { error: e } = await s.supabase.from("ml_orders").update({ invoice_none: none, ...(none ? { invoice_id: null, invoice_link: null } : {}) })
    .eq("id", orderId).eq("org_id", s.org.org_id);
  if (e) return { ok: false, error: friendlyDbError(e) };
  return done();
}
