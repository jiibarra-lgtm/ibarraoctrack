"use server";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/session";
import { canBill } from "@/lib/billing";
import { isUuid } from "@/lib/utils";

/** Marca un movimiento como entrada o salida; queda aprendido para esa contraparte. */
export async function setDirection(movementId: string, direction: "in" | "out"): Promise<{ ok: true; n: number } | { ok: false; error: string }> {
  const s = await requireOrg();
  if (!canBill(s.org.role)) return { ok: false, error: "Sólo administración y finanzas" };
  if (!isUuid(movementId) || !["in", "out"].includes(direction)) return { ok: false, error: "Datos inválidos" };
  const { data, error } = await s.supabase.rpc("bank_set_direction", { p_org: s.org.org_id, p_movement: movementId, p_direction: direction, p_learn: true });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/banco");
  revalidatePath("/cobranzas");
  return { ok: true, n: Number(data ?? 1) };
}
