"use server";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/session";
import { canBill } from "@/lib/billing";
import { isUuid } from "@/lib/utils";

export async function matchDeposit(movementId: string, voucherIds: string[]): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await requireOrg();
  if (!canBill(s.org.role)) return { ok: false, error: "Sólo administración y finanzas" };
  if (!isUuid(movementId) || !voucherIds.length || voucherIds.length > 50 || !voucherIds.every(isUuid)) return { ok: false, error: "Datos inválidos" };
  const { error } = await s.supabase.rpc("bank_match_manual", { p_org: s.org.org_id, p_movement: movementId, p_vouchers: voucherIds });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/cobranzas");
  revalidatePath("/impuestos");
  return { ok: true };
}
