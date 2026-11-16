"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg, canWrite, type AppRole } from "@/lib/session";
import { friendlyDbError } from "@/lib/errors";
import { isUuid } from "@/lib/utils";

type R = { ok: true } | { ok: false; error: string };
const can = (r: AppRole) => canWrite(r) || r === "logistica";
const done = () => { revalidatePath("/entregas/pendientes"); revalidatePath("/entregas"); };

const itemSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  place: z.string().trim().min(1, "Poné a dónde se lleva").max(200),
  address: z.string().trim().max(300).optional().default(""),
  note: z.string().trim().max(2000).optional().default(""),
  oc_text: z.string().trim().max(300).optional().default(""),
});

/** Crea o edita una tarjeta de la hoja de ruta. */
export async function saveBoardItem(input: z.input<typeof itemSchema>): Promise<R> {
  const s = await requireOrg();
  if (!can(s.org.role)) return { ok: false, error: "Tu rol no permite editar entregas" };
  const p = itemSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
  const row = { place: p.data.place, address: p.data.address || null, note: p.data.note || null, oc_text: p.data.oc_text || null };
  const { error } = p.data.id
    ? await s.supabase.from("delivery_board").update(row).eq("id", p.data.id).eq("org_id", s.org.org_id)
    : await s.supabase.from("delivery_board").insert({ ...row, org_id: s.org.org_id, position: -Math.floor(Date.now() / 1000) });
  if (error) return { ok: false, error: friendlyDbError(error) };
  done();
  return { ok: true };
}

/** Marca entregado (con fecha) o la vuelve a pendiente. */
export async function setBoardStatus(id: string, status: "pendiente" | "entregado", date?: string): Promise<R> {
  const s = await requireOrg();
  if (!can(s.org.role) || !isUuid(id)) return { ok: false, error: "No permitido" };
  const d = date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : null;
  const { error } = await s.supabase.from("delivery_board").update({ status, delivered_on: status === "entregado" ? d : null }).eq("id", id).eq("org_id", s.org.org_id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  done();
  return { ok: true };
}

export async function deleteBoardItem(id: string): Promise<R> {
  const s = await requireOrg();
  if (!can(s.org.role) || !isUuid(id)) return { ok: false, error: "No permitido" };
  const { error } = await s.supabase.from("delivery_board").delete().eq("id", id).eq("org_id", s.org.org_id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  done();
  return { ok: true };
}

/** Agrega a la hoja de ruta una OC que tiene entregas pendientes. */
export async function addOrderToBoard(poId: string): Promise<R> {
  const s = await requireOrg();
  if (!can(s.org.role) || !isUuid(poId)) return { ok: false, error: "No permitido" };
  const { data: po } = await s.supabase.from("purchase_orders_overview").select("bac_number, display_number, customer_name, dependencia, delivery_place")
    .eq("id", poId).eq("org_id", s.org.org_id).maybeSingle();
  if (!po) return { ok: false, error: "Orden no encontrada" };
  const { data: items } = await s.supabase.from("purchase_order_items").select("quantity, description_normalized, description_original, line_number")
    .eq("purchase_order_id", poId).order("line_number").limit(8);
  const note = (items ?? []).map((i) => `${Number(i.quantity).toLocaleString("es-AR")} ${String(i.description_normalized || i.description_original).split(/[·.(]/)[0].trim().toLowerCase()}`).join(" - ");
  const { error } = await s.supabase.from("delivery_board").insert({
    org_id: s.org.org_id, place: (po.dependencia || po.customer_name || "Sin organismo").slice(0, 200), address: po.delivery_place?.slice(0, 300) ?? null,
    note: note.slice(0, 2000) || null, oc_text: po.bac_number ?? po.display_number, position: -Math.floor(Date.now() / 1000),
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  done();
  return { ok: true };
}
