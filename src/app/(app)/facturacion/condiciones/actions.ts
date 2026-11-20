"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg } from "@/lib/session";
import { canBill } from "@/lib/billing";
import { friendlyDbError } from "@/lib/errors";
import { PAYMENT_KINDS } from "@/lib/einvoice";

type R = { ok: true } | { ok: false; error: string };

const Cond = z.object({
  id: z.string().uuid().nullable(),
  code: z.number().int().min(1).max(999),
  name: z.string().trim().min(2, "Poné un nombre").max(60),
  arca_kind: z.enum(Object.keys(PAYMENT_KINDS) as [string, ...string[]]),
  days: z.array(z.number().int().min(0).max(720)).max(12),
  notes: z.string().trim().max(300).nullable(),
});

async function guard() {
  const s = await requireOrg();
  if (!canBill(s.org.role)) throw new Error("Sólo administración y finanzas pueden cambiar las condiciones de venta");
  return s;
}

export async function saveSaleCondition(input: z.input<typeof Cond>): Promise<R> {
  try {
    const s = await guard();
    const p = Cond.safeParse(input);
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
    const v = p.data;
    const days = [...new Set(v.days)].sort((a, b) => a - b);
    const row = { org_id: s.org.org_id, code: v.code, name: v.name, arca_kind: v.arca_kind, days, notes: v.notes || null, updated_at: new Date().toISOString() };
    const { error } = v.id
      ? await s.supabase.from("sale_conditions").update(row).eq("id", v.id).eq("org_id", s.org.org_id)
      : await s.supabase.from("sale_conditions").insert(row);
    if (error) return { ok: false, error: error.code === "23505" ? `Ya hay una condición con el código ${v.code}` : friendlyDbError(error) };
    revalidatePath("/facturacion/condiciones");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function setDefaultCondition(id: string): Promise<R> {
  try {
    const s = await guard();
    await s.supabase.from("sale_conditions").update({ is_default: false }).eq("org_id", s.org.org_id).eq("is_default", true);
    const { error } = await s.supabase.from("sale_conditions").update({ is_default: true, active: true }).eq("id", id).eq("org_id", s.org.org_id);
    if (error) return { ok: false, error: friendlyDbError(error) };
    revalidatePath("/facturacion/condiciones");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

export async function toggleCondition(id: string, active: boolean): Promise<R> {
  try {
    const s = await guard();
    const { data } = await s.supabase.from("sale_conditions").select("is_default").eq("id", id).eq("org_id", s.org.org_id).maybeSingle();
    if (!active && data?.is_default) return { ok: false, error: "Es la predeterminada: elegí otra como predeterminada antes de desactivarla" };
    const { error } = await s.supabase.from("sale_conditions").update({ active }).eq("id", id).eq("org_id", s.org.org_id);
    if (error) return { ok: false, error: friendlyDbError(error) };
    revalidatePath("/facturacion/condiciones");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}

/** Condición habitual de un cliente (la que se propone al facturarle). */
export async function setCustomerCondition(customerId: string, conditionId: string | null): Promise<R> {
  try {
    const s = await guard();
    if (!z.string().uuid().safeParse(customerId).success) return { ok: false, error: "Cliente inválido" };
    const { error } = await s.supabase.from("customers").update({ sale_condition_id: conditionId || null }).eq("id", customerId).eq("org_id", s.org.org_id);
    if (error) return { ok: false, error: friendlyDbError(error) };
    revalidatePath("/facturacion/condiciones");
    return { ok: true };
  } catch (e) { return { ok: false, error: (e as Error).message }; }
}
