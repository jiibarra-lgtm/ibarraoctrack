"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg } from "@/lib/session";
import { canBill } from "@/lib/billing";
import { refreshPadron, syncEmitted } from "@/lib/tax-sync";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };

const Settings = z.object({
  iibb_rate: z.number().min(0).max(20), iibb_day: z.number().int().min(1).max(28),
  autonomos: z.boolean(), autonomos_day: z.number().int().min(1).max(28),
  gni: z.number().min(0), special_deduction: z.number().min(0), other_deductions: z.number().min(0), ganancias_paid: z.number().min(0),
});

export async function saveTaxSettings(raw: z.infer<typeof Settings>): Promise<R> {
  const s = await requireOrg();
  if (!canBill(s.org.role)) return { ok: false, error: "Sólo administración y finanzas" };
  const p = Settings.safeParse(raw);
  if (!p.success) return { ok: false, error: "Revisá los valores" };
  const { error } = await s.supabase.rpc("tax_settings_save", { p_org: s.org.org_id, p: p.data });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/impuestos");
  return { ok: true };
}

export async function syncEmittedNow(): Promise<R<{ added: number }>> {
  const s = await requireOrg();
  if (!canBill(s.org.role)) return { ok: false, error: "Sólo administración y finanzas" };
  try {
    const r = await syncEmitted(s.supabase, s.org.org_id, 200);
    revalidatePath("/impuestos");
    return { ok: true, added: r.added };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function checkPadronNow(): Promise<R> {
  const s = await requireOrg();
  if (!canBill(s.org.role)) return { ok: false, error: "Sólo administración y finanzas" };
  try {
    await refreshPadron(s.supabase, s.org.org_id);
    revalidatePath("/impuestos");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** Alícuota de SIRCREB que figura en tu padrón (para detectar si el banco retiene de más). Vacío = sin cargar. */
export async function saveSircrebRate(raw: string): Promise<R> {
  const s = await requireOrg();
  if (!canBill(s.org.role)) return { ok: false, error: "Sólo administración y finanzas" };
  const t = raw.trim().replace(",", ".");
  const v = t === "" ? "" : Number(t);
  if (v !== "" && !(v >= 0 && v <= 10)) return { ok: false, error: "Alícuota inválida (0 a 10%)" };
  const { error } = await s.supabase.rpc("tax_settings_extra", { p_org: s.org.org_id, p: { sircreb_rate: v === "" ? "" : String(v) } });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/impuestos");
  return { ok: true };
}

/** Marca un aviso fiscal (o todos, sin id) como visto. */
export async function markNoticeSeen(id: string | null): Promise<R> {
  const s = await requireOrg();
  if (!canBill(s.org.role)) return { ok: false, error: "Sólo administración y finanzas" };
  if (id !== null && !/^[0-9a-f-]{36}$/i.test(id)) return { ok: false, error: "Aviso inválido" };
  const { error } = await s.supabase.rpc("tax_notice_seen", { p_org: s.org.org_id, p_id: id });
  if (error) return { ok: false, error: error.message };
  revalidatePath("/impuestos");
  return { ok: true };
}
