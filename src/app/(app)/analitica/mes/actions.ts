"use server";
import { revalidatePath } from "next/cache";
import { requireOrg, canWrite } from "@/lib/session";
import { isUuid } from "@/lib/utils";
import { parseArNumber } from "@/lib/money";
import { friendlyDbError } from "@/lib/errors";

/**
 * Costo unitario (sin IVA) de un renglón de OC. Si el renglón es de un convenio, el costo también queda
 * en Productos y se aplica a las otras OC de ese renglón que no tengan un costo propio.
 */
export async function setItemCost(itemId: string, raw: string, convenioLineId: string | null) {
  const s = await requireOrg();
  if (!canWrite(s.org.role) || !isUuid(itemId)) return { ok: false as const, error: "No permitido" };
  const t = raw.trim().replace(/\$/g, "").replace(/\s/g, "");
  const v = t === "" ? null : parseArNumber(t);
  if (t !== "" && (v === null || Number(v) < 0)) return { ok: false as const, error: "Número inválido" };
  if (convenioLineId && isUuid(convenioLineId) && ["admin", "finanzas", "compras"].includes(s.org.role)) {
    const { error } = await s.supabase.rpc("convenio_set_cost", { p_org: s.org.org_id, p_line: convenioLineId, p_cost: v });
    if (error) return { ok: false as const, error: friendlyDbError(error) };
  }
  const { error } = await s.supabase.from("purchase_order_items").update({ estimated_unit_cost: v }).eq("id", itemId).eq("org_id", s.org.org_id);
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  revalidatePath("/analitica/mes");
  revalidatePath("/dashboard");
  revalidatePath("/productos");
  return { ok: true as const };
}

export type SupplierPick = { id: string; description: string; code: string | null; supplier: string; date: string | null; unit_net: number; unit_final: number | null; pack: number | null; unit: string | null; number: string };

/** Productos comprados (renglones de facturas de proveedores) para tomar el costo de un renglón de OC. */
export async function searchSupplierItems(q: string) {
  const s = await requireOrg();
  const words = q.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9 ]/g, " ").split(/\s+/).filter((w) => w.length >= 3).slice(0, 4);
  if (!words.length) return { ok: true as const, rows: [] as SupplierPick[] };
  let qy = s.supabase.from("supplier_items_overview").select("id, description, code, supplier_name, issue_date, unit_net, unit_final, pack, unit, point_of_sale, number, product_key")
    .eq("org_id", s.org.org_id).order("issue_date", { ascending: false, nullsFirst: false }).limit(60);
  for (const w of words) qy = qy.or(`description.ilike.%${w}%,code.ilike.%${w}%,supplier_name.ilike.%${w}%`);
  const { data, error } = await qy;
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  const seen = new Set<string>();
  const rows: SupplierPick[] = [];
  for (const r of (data ?? []) as Record<string, unknown>[]) {
    const k = String(r.product_key ?? r.id);
    if (seen.has(k)) continue;
    seen.add(k);
    rows.push({ id: String(r.id), description: String(r.description), code: (r.code as string) ?? null, supplier: String(r.supplier_name ?? ""), date: (r.issue_date as string) ?? null,
      unit_net: Number(r.unit_net), unit_final: r.unit_final == null ? null : Number(r.unit_final), pack: r.pack == null ? null : Number(r.pack), unit: (r.unit as string) ?? null,
      number: r.point_of_sale ? `${String(r.point_of_sale).padStart(5, "0")}-${String(r.number ?? 0).padStart(8, "0")}` : "sin número" });
  }
  return { ok: true as const, rows: rows.slice(0, 20) };
}

/** Toma el costo de un producto comprado: costo sin IVA = neto unitario de la factura ÷ cuántas unidades de la OC salen de una comprada. */
export async function linkSupplierCost(itemId: string, sourceId: string | null, divisor: number, convenioLineId: string | null) {
  const s = await requireOrg();
  if (!canWrite(s.org.role) || !isUuid(itemId) || (sourceId && !isUuid(sourceId))) return { ok: false as const, error: "No permitido" };
  if (!sourceId) {
    const { error } = await s.supabase.from("purchase_order_items").update({ cost_source_item_id: null, cost_source_divisor: null }).eq("id", itemId).eq("org_id", s.org.org_id);
    if (error) return { ok: false as const, error: friendlyDbError(error) };
    revalidatePath("/analitica/mes");
    return { ok: true as const };
  }
  if (!Number.isFinite(divisor) || divisor <= 0 || divisor > 1e6) return { ok: false as const, error: "Cantidad inválida" };
  const { data: src } = await s.supabase.from("supplier_invoice_items").select("unit_net").eq("id", sourceId).eq("org_id", s.org.org_id).maybeSingle();
  if (!src) return { ok: false as const, error: "Producto no encontrado" };
  const cost = Math.round((Number(src.unit_net) / divisor) * 100) / 100;
  const r = await setItemCost(itemId, String(cost).replace(".", ","), convenioLineId);
  if (!r.ok) return r;
  const { error } = await s.supabase.from("purchase_order_items").update({ cost_source_item_id: sourceId, cost_source_divisor: divisor }).eq("id", itemId).eq("org_id", s.org.org_id);
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  revalidatePath("/ordenes");
  return { ok: true as const, cost };
}
