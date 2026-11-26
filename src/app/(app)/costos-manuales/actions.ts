"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg, canWrite } from "@/lib/session";
import { friendlyDbError } from "@/lib/errors";
import { isValidDecimal, parseArNumber } from "@/lib/money";

type Res<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const PATH = "/costos-manuales";

async function writer() {
  const s = await requireOrg();
  if (!canWrite(s.org.role)) throw new Error("Tu rol no permite editar costos.");
  return s;
}
const fail = (e: unknown) => ({ ok: false as const, error: (e as Error).message || "Error" });
const optMoney = z.string().trim().transform((v) => (v === "" ? null : (parseArNumber(v) ?? v))).refine((v) => v === null || isValidDecimal(v), "Importe inválido");

const costSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  sku: z.string().trim().max(40).optional().default(""),
  description: z.string().trim().min(1, "Descripción obligatoria").max(300),
  supplier: z.string().trim().max(120).optional().default(""),
  cost: optMoney,
  includes_vat: z.boolean(),
  vat_pct: z.string().trim().transform((v) => parseArNumber(v || "21") ?? v).refine((v) => isValidDecimal(v) && Number(v) >= 0 && Number(v) <= 100, "IVA inválido"),
  notes: z.string().trim().max(1000).optional().default(""),
});
export type ManualCostInput = z.input<typeof costSchema>;

export async function saveManualCost(input: ManualCostInput): Promise<Res> {
  try {
    const s = await writer();
    const p = costSchema.safeParse(input);
    if (!p.success) return { ok: false, error: p.error.issues[0].message };
    const d = p.data;
    const row = { sku: d.sku || null, description: d.description, supplier: d.supplier ? d.supplier.toUpperCase() : null, cost: d.cost, includes_vat: d.includes_vat, vat_pct: d.vat_pct, notes: d.notes || null };
    const q = d.id
      ? s.supabase.from("manual_costs").update(row).eq("id", d.id).eq("org_id", s.org.org_id)
      : s.supabase.from("manual_costs").insert({ ...row, org_id: s.org.org_id, source: "manual" });
    const { error } = await q;
    if (error) return { ok: false, error: friendlyDbError(error) };
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function deleteManualCost(id: string): Promise<Res> {
  try {
    const s = await writer();
    if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Costo inválido" };
    const { error } = await s.supabase.from("manual_costs").delete().eq("id", id).eq("org_id", s.org.org_id);
    if (error) return { ok: false, error: friendlyDbError(error) };
    revalidatePath(PATH);
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Busca órdenes de compra por número BAC, número interno u organismo (para vincular a mano). */
export async function searchOrders(q: string): Promise<Res<{ orders: { id: string; label: string; customer: string | null; status: string }[] }>> {
  try {
    const s = await requireOrg();
    const t = q.trim().replace(/[%,()]/g, " ").slice(0, 60);
    let query = s.supabase.from("purchase_orders_overview").select("id, bac_number, display_number, customer_name, status").eq("org_id", s.org.org_id).order("created_at", { ascending: false }).limit(15);
    if (t) query = query.or(`bac_number.ilike.%${t}%,display_number.ilike.%${t}%,customer_name.ilike.%${t}%`);
    const { data, error } = await query;
    if (error) return { ok: false, error: friendlyDbError(error) };
    return { ok: true, orders: (data ?? []).map((o) => ({ id: o.id, label: String(o.bac_number ?? o.display_number), customer: o.customer_name, status: o.status })) };
  } catch (e) { return fail(e); }
}

export async function orderLines(poId: string): Promise<Res<{ lines: { id: string; label: string; quantity: number; unit: string | null }[] }>> {
  try {
    const s = await requireOrg();
    if (!z.string().uuid().safeParse(poId).success) return { ok: false, error: "Orden inválida" };
    const { data, error } = await s.supabase.from("purchase_order_items").select("id, line_number, option_number, description_original, quantity, unit").eq("purchase_order_id", poId).eq("org_id", s.org.org_id).order("line_number").order("option_number");
    if (error) return { ok: false, error: friendlyDbError(error) };
    return { ok: true, lines: (data ?? []).map((l) => ({ id: l.id, label: `R${l.line_number}${l.option_number > 1 ? `.${l.option_number}` : ""} · ${l.description_original}`, quantity: Number(l.quantity), unit: l.unit })) };
  } catch (e) { return fail(e); }
}

const linkSchema = z.object({
  manual_cost_id: z.string().uuid(),
  purchase_order_id: z.string().uuid("Elegí una orden"),
  purchase_order_item_id: z.string().uuid().optional().or(z.literal("")),
  quantity: optMoney.refine((v) => v === null || Number(v) > 0, "La cantidad tiene que ser mayor a 0"),
  notes: z.string().trim().max(500).optional().default(""),
});
export type LinkInput = z.input<typeof linkSchema>;

export async function linkManualCost(input: LinkInput): Promise<Res> {
  try {
    const s = await writer();
    const p = linkSchema.safeParse(input);
    if (!p.success) return { ok: false, error: p.error.issues[0].message };
    const d = p.data;
    const { error } = await s.supabase.from("manual_cost_links").insert({
      org_id: s.org.org_id, manual_cost_id: d.manual_cost_id, purchase_order_id: d.purchase_order_id,
      purchase_order_item_id: d.purchase_order_item_id || null, quantity: d.quantity, notes: d.notes || null,
    });
    if (error) return { ok: false, error: error.code === "23505" ? "Ese costo ya está vinculado a ese renglón" : friendlyDbError(error) };
    revalidatePath(PATH);
    revalidatePath(`/ordenes/${d.purchase_order_id}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function unlinkManualCost(id: string): Promise<Res> {
  try {
    const s = await writer();
    if (!z.string().uuid().safeParse(id).success) return { ok: false, error: "Vínculo inválido" };
    const { data, error } = await s.supabase.from("manual_cost_links").delete().eq("id", id).eq("org_id", s.org.org_id).select("purchase_order_id").maybeSingle();
    if (error) return { ok: false, error: friendlyDbError(error) };
    revalidatePath(PATH);
    if (data?.purchase_order_id) revalidatePath(`/ordenes/${data.purchase_order_id}`);
    return { ok: true };
  } catch (e) { return fail(e); }
}
