"use server";
import { revalidatePath } from "next/cache";
import { requireOrg, canWrite } from "@/lib/session";

/** Saca una OC de la lista de "faltan cargar" (no es nuestra, se anuló, ya no aplica). */
export async function dismissMissingOc(bacNumber: string, undo = false): Promise<{ ok: boolean; error?: string }> {
  const s = await requireOrg();
  if (!canWrite(s.org.role)) return { ok: false, error: "Tu rol no permite cambiar esta lista" };
  const n = bacNumber.trim().toUpperCase();
  if (!/^\d{2,5}-\d{3,7}-OC\d{2}$/.test(n)) return { ok: false, error: "Número inválido" };
  const q = undo
    ? s.supabase.from("oc_missing_dismissed").delete().eq("org_id", s.org.org_id).eq("bac_number", n)
    : s.supabase.from("oc_missing_dismissed").upsert({ org_id: s.org.org_id, bac_number: n });
  const { error } = await q;
  if (error) return { ok: false, error: "No se pudo guardar" };
  revalidatePath("/ordenes");
  revalidatePath("/ordenes/importar");
  revalidatePath("/dashboard");
  return { ok: true };
}
