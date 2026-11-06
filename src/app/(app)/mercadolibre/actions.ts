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
