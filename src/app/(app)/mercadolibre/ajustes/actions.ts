"use server";
import { revalidatePath } from "next/cache";
import { requireOrg, canWrite } from "@/lib/session";
import { labelPrefs, profitRules, type LabelPrefs, type ProfitRules } from "@/lib/ml/prefs";

type R = { ok: true } | { ok: false; error: string };

async function save(patch: Record<string, unknown>): Promise<R> {
  const s = await requireOrg();
  if (!canWrite(s.org.role)) return { ok: false, error: "No tenés permiso para modificar" };
  const { error } = await s.supabase.from("ml_settings").upsert({ org_id: s.org.org_id, ...patch, updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: error.message };
  for (const p of ["/mercadolibre/ajustes", "/mercadolibre/stats", "/mercadolibre/panel", "/mercadolibre/ventas"]) revalidatePath(p);
  return { ok: true };
}

export async function saveLabelPrefs(p: LabelPrefs): Promise<R> {
  return save({ label_prefs: labelPrefs(p) });
}

export async function saveProfitRules(r: ProfitRules): Promise<R> {
  const v = profitRules(r);
  if (v.paymentPct > 50 || v.taxesPct > 50) return { ok: false, error: "Los porcentajes parecen demasiado altos" };
  return save({ profit_rules: v });
}
