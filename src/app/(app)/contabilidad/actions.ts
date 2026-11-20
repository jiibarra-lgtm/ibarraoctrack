"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg } from "@/lib/session";
import { canBill } from "@/lib/billing";
import { friendlyDbError } from "@/lib/errors";
import { isUuid } from "@/lib/utils";
import { validateEntry } from "@/lib/accounting";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: (e as Error).message || "Error inesperado" });
async function guard() {
  const s = await requireOrg();
  if (!canBill(s.org.role)) throw new Error("Sólo administración y finanzas");
  return s;
}
const ymd = /^\d{4}-\d{2}-\d{2}$/;

/** Rearma los asientos automáticos del período con lo último de ventas, compras, banco, caja, cheques e IIBB. */
export async function generateEntries(from: string, to: string): Promise<R<{ n: number }>> {
  try {
    const s = await guard();
    if (!ymd.test(from) || !ymd.test(to) || to < from) return { ok: false, error: "Período inválido" };
    const { data, error } = await s.supabase.rpc("acc_generate", { p_org: s.org.org_id, p_from: from, p_to: to });
    if (error) return { ok: false, error: error.message };
    revalidatePath("/contabilidad");
    return { ok: true, n: Number(data ?? 0) };
  } catch (e) { return fail(e); }
}

const Entry = z.object({
  date: z.string().regex(ymd, "Fecha inválida"),
  description: z.string().trim().min(3, "Poné una descripción").max(300),
  lines: z.array(z.object({ account_code: z.string().min(1), debit: z.number().min(0).max(1e13), credit: z.number().min(0).max(1e13) })).min(2).max(40),
});

/** Asiento manual (apertura, ajustes, amortizaciones, sueldos, etc.). */
export async function saveManualEntry(input: z.input<typeof Entry>): Promise<R> {
  try {
    const s = await guard();
    const p = Entry.safeParse(input);
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
    const lines = p.data.lines.filter((l) => l.debit > 0 || l.credit > 0);
    const bad = validateEntry(lines);
    if (bad) return { ok: false, error: bad };
    const org = s.org.org_id;
    const { data: accs } = await s.supabase.from("acc_accounts").select("code").eq("org_id", org).eq("imputable", true).eq("active", true).in("code", lines.map((l) => l.account_code));
    const ok = new Set((accs ?? []).map((a) => a.code));
    const miss = lines.find((l) => !ok.has(l.account_code));
    if (miss) return { ok: false, error: `La cuenta ${miss.account_code} no existe o no es imputable` };
    const { data: e, error } = await s.supabase.from("acc_entries").insert({ org_id: org, entry_date: p.data.date, description: p.data.description, source: "manual", auto: false }).select("id").single();
    if (error || !e) return { ok: false, error: error ? friendlyDbError(error) : "No se pudo guardar" };
    const { error: le } = await s.supabase.from("acc_lines").insert(lines.map((l) => ({ entry_id: e.id, org_id: org, account_code: l.account_code, debit: l.debit, credit: l.credit })));
    if (le) { await s.supabase.from("acc_entries").delete().eq("id", e.id).eq("org_id", org); return { ok: false, error: friendlyDbError(le) }; }
    revalidatePath("/contabilidad");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function deleteManualEntry(id: string): Promise<R> {
  try {
    const s = await guard();
    if (!isUuid(id)) return { ok: false, error: "Asiento inválido" };
    const { error } = await s.supabase.from("acc_entries").delete().eq("id", id).eq("org_id", s.org.org_id).eq("auto", false);
    if (error) return { ok: false, error: friendlyDbError(error) };
    revalidatePath("/contabilidad");
    return { ok: true };
  } catch (e) { return fail(e); }
}

const Acc = z.object({
  code: z.string().trim().regex(/^\d(\.\d{1,2}){0,2}$/, "Código tipo 5.2.07"),
  name: z.string().trim().min(2).max(80),
  type: z.enum(["activo", "pasivo", "patrimonio", "ingreso", "egreso"]),
});

/** Nueva cuenta imputable en el plan (la madre tiene que existir). */
export async function saveAccount(input: z.input<typeof Acc>): Promise<R> {
  try {
    const s = await guard();
    const p = Acc.safeParse(input);
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
    const parent = p.data.code.split(".").slice(0, -1).join(".");
    if (parent) {
      const { data: par } = await s.supabase.from("acc_accounts").select("code").eq("org_id", s.org.org_id).eq("code", parent).maybeSingle();
      if (!par) return { ok: false, error: `No existe la cuenta madre ${parent}` };
    }
    const { error } = await s.supabase.from("acc_accounts").insert({ org_id: s.org.org_id, ...p.data, imputable: p.data.code.split(".").length === 3 });
    if (error) return { ok: false, error: error.code === "23505" ? "Ya existe una cuenta con ese código" : friendlyDbError(error) };
    revalidatePath("/contabilidad");
    return { ok: true };
  } catch (e) { return fail(e); }
}
