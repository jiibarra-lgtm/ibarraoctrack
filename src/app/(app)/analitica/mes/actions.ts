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
