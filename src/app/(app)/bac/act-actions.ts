"use server";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/session";
import { isUuid } from "@/lib/utils";

export async function reviewAct(id: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const s = await requireOrg();
  if (!["admin", "finanzas", "compras"].includes(s.org.role) || !isUuid(id)) return { ok: false, error: "No permitido" };
  const { error } = await s.supabase.rpc("bac_act_review", { p_org: s.org.org_id, p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/bac");
  revalidatePath("/ordenes", "layout");
  return { ok: true };
}
