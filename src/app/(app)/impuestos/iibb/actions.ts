"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg } from "@/lib/session";
import { canBill } from "@/lib/billing";
import { friendlyDbError } from "@/lib/errors";
import { coefSum, liquidateIibb, type IibbDeductions } from "@/lib/iibb";

type R = { ok: true } | { ok: false; error: string };
const fail = (e: unknown): R => ({ ok: false, error: (e as Error).message || "Error inesperado" });
async function guard() {
  const s = await requireOrg();
  if (!canBill(s.org.role)) throw new Error("Sólo administración y finanzas");
  return s;
}

const Jur = z.object({ code: z.number().int().min(901).max(924), coefficient: z.number().min(0).max(1), rate: z.number().min(0).max(20), active: z.boolean() });

/** Coeficientes unificados y alícuotas de cada jurisdicción (los del CM05 del año). */
export async function saveJurisdictions(rows: z.input<typeof Jur>[]): Promise<R> {
  try {
    const s = await guard();
    const p = z.array(Jur).min(1).max(24).safeParse(rows);
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
    const active = p.data.filter((j) => j.active);
    if (!active.length) return { ok: false, error: "Tiene que haber al menos una jurisdicción activa" };
    const sum = coefSum(active.map((j) => ({ code: j.code, coefficient: j.coefficient, rate: j.rate })));
    if (Math.abs(sum - 1) > 0.0005) return { ok: false, error: `Los coeficientes de las activas suman ${sum.toFixed(4)}: tienen que sumar 1` };
    const { error } = await s.supabase.from("iibb_jurisdictions").upsert(p.data.map((j) => ({ ...j, org_id: s.org.org_id, updated_at: new Date().toISOString() })));
    if (error) return { ok: false, error: friendlyDbError(error) };
    revalidatePath("/impuestos/iibb");
    return { ok: true };
  } catch (e) { return fail(e); }
}

const Ded = z.object({ retenciones: z.number().min(0), percepciones: z.number().min(0), sircreb: z.number().min(0) });

/** Guarda la liquidación del mes (borrador o presentada). Se recalcula acá con los coeficientes guardados. */
export async function saveIibbFiling(month: string, base: number, deductions: Record<string, z.input<typeof Ded>>, status: "borrador" | "presentada"): Promise<R> {
  try {
    const s = await guard();
    if (!/^\d{4}-\d{2}$/.test(month) || !Number.isFinite(base)) return { ok: false, error: "Datos inválidos" };
    const org = s.org.org_id;
    const [{ data: js }, { data: kept }] = await Promise.all([
      s.supabase.from("iibb_jurisdictions").select("code, coefficient, rate").eq("org_id", org).eq("active", true),
      s.supabase.from("iibb_filings").select("detail").eq("org_id", org).eq("month", month).maybeSingle(),
    ]);
    // Si el mes ya tenía liquidación guardada, se respetan sus coeficientes y alícuotas
    const keptRows = ((kept?.detail ?? []) as { code: number; coefficient: number; rate: number }[]);
    const jur = keptRows.length
      ? keptRows.map((j) => ({ code: Number(j.code), coefficient: Number(j.coefficient), rate: Number(j.rate) }))
      : (js ?? []).map((j) => ({ code: Number(j.code), coefficient: Number(j.coefficient), rate: Number(j.rate) }));
    if (!jur.length) return { ok: false, error: "Cargá las jurisdicciones primero" };
    const ded: Record<number, IibbDeductions> = {};
    for (const j of jur) { const d = Ded.safeParse(deductions[String(j.code)] ?? { retenciones: 0, percepciones: 0, sircreb: 0 }); if (!d.success) return { ok: false, error: "Deducciones inválidas" }; ded[j.code] = d.data; }
    const prevMonth = new Date(Date.UTC(Number(month.slice(0, 4)), Number(month.slice(5, 7)) - 2, 1)).toISOString().slice(0, 7);
    const { data: prev } = await s.supabase.from("iibb_filings").select("detail").eq("org_id", org).eq("month", prevMonth).maybeSingle();
    const favorPrev: Record<number, number> = {};
    for (const r of ((prev?.detail ?? []) as { code: number; favor_next: number }[])) favorPrev[r.code] = Number(r.favor_next) || 0;
    const l = liquidateIibb(base, jur, ded, favorPrev);
    const { data: cur } = await s.supabase.from("iibb_filings").select("status").eq("org_id", org).eq("month", month).maybeSingle();
    if (cur?.status === "presentada" && status === "borrador") return { ok: false, error: "Ya está presentada" };
    const { error } = await s.supabase.from("iibb_filings").upsert({
      org_id: org, month, base, detail: l.rows, total_tax: l.totalTax, total_due: l.totalDue, status,
      presented_at: status === "presentada" ? new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10) : null, updated_at: new Date().toISOString(),
    }, { onConflict: "org_id,month" });
    if (error) return { ok: false, error: friendlyDbError(error) };
    revalidatePath("/impuestos/iibb");
    revalidatePath("/tesoreria/flujo");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function reopenIibbFiling(month: string): Promise<R> {
  try {
    const s = await guard();
    const { error } = await s.supabase.from("iibb_filings").update({ status: "borrador", presented_at: null, paid_at: null }).eq("org_id", s.org.org_id).eq("month", month);
    if (error) return { ok: false, error: friendlyDbError(error) };
    revalidatePath("/impuestos/iibb");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function markIibbPaid(month: string, paid: boolean): Promise<R> {
  try {
    const s = await guard();
    const { error } = await s.supabase.from("iibb_filings").update({ paid_at: paid ? new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10) : null })
      .eq("org_id", s.org.org_id).eq("month", month).eq("status", "presentada");
    if (error) return { ok: false, error: friendlyDbError(error) };
    revalidatePath("/impuestos/iibb");
    revalidatePath("/tesoreria/flujo");
    return { ok: true };
  } catch (e) { return fail(e); }
}
