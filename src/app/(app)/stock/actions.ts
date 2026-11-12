"use server";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/session";
import { isUuid } from "@/lib/utils";

type R = { ok: true } | { ok: false; error: string };

export async function stockAction(action: "link" | "new_item" | "adjust" | "update" | "merge", p: Record<string, unknown>): Promise<R> {
  const s = await requireOrg();
  if (!["admin", "compras", "finanzas", "logistica"].includes(s.org.role)) return { ok: false, error: "Tu rol no permite modificar el stock" };
  for (const k of ["item_id", "from", "into"]) if (p[k] && !isUuid(String(p[k]))) return { ok: false, error: "Producto inválido" };
  if (action === "adjust" && (!Number.isFinite(Number(p.qty)) || Number(p.qty) === 0 || !String(p.note ?? "").trim())) return { ok: false, error: "Poné la cantidad y el motivo" };
  const { error } = await s.supabase.rpc("stock_action", { p_org: s.org.org_id, p_action: action, p });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/stock");
  return { ok: true };
}
