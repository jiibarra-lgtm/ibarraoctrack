"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg } from "@/lib/session";
import { friendlyDbError } from "@/lib/errors";
import { parseArNumber } from "@/lib/money";
import { isUuid } from "@/lib/utils";

type R = { ok: true } | { ok: false; error: string };
const CATS = ["sueldos", "alquiler", "servicios", "telefonia", "salud", "impuestos", "seguros", "honorarios", "bancos", "software", "vehiculos", "otros"] as const;
const can = (role: string) => ["admin", "finanzas", "compras"].includes(role);

const Cost = z.object({
  name: z.string().trim().min(1, "Poné un nombre").max(120),
  category: z.enum(CATS),
  amount: z.string().trim().max(30),
  frequency: z.coerce.number().int().refine((n) => [1, 2, 3, 6, 12].includes(n)),
  due_day: z.string().trim().max(2).optional().default(""),
  notes: z.string().trim().max(500).optional().default(""),
});
export type CostInput = z.input<typeof Cost>;

const done = (): R => { revalidatePath("/gastos-fijos"); return { ok: true }; };

export async function saveFixedCost(input: CostInput, id?: string): Promise<R> {
  const s = await requireOrg();
  if (!can(s.org.role)) return { ok: false, error: "Tu rol no permite modificar gastos" };
  const p = Cost.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
  const amount = p.data.amount ? parseArNumber(p.data.amount) : "0";
  if (amount === null || Number(amount) < 0) return { ok: false, error: "Importe inválido" };
  const day = p.data.due_day ? Number(p.data.due_day) : null;
  if (day !== null && (!Number.isInteger(day) || day < 1 || day > 31)) return { ok: false, error: "Día de vencimiento inválido" };
  const row = { name: p.data.name, category: p.data.category, amount, frequency: p.data.frequency, due_day: day, notes: p.data.notes || null };
  const { error } = id
    ? (isUuid(id) ? await s.supabase.from("fixed_costs").update(row).eq("id", id).eq("org_id", s.org.org_id) : { error: { message: "Gasto inválido" } as never })
    : await s.supabase.from("fixed_costs").insert({ ...row, org_id: s.org.org_id, source: "manual", created_by: s.userId });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return done();
}

export async function setCostActive(id: string, active: boolean): Promise<R> {
  const s = await requireOrg();
  if (!can(s.org.role) || !isUuid(id)) return { ok: false, error: "No permitido" };
  const { error } = await s.supabase.from("fixed_costs").update({ active }).eq("id", id).eq("org_id", s.org.org_id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  return done();
}

/** Convierte un proveedor que factura todos los meses (según ARCA) en gasto fijo. */
export async function addFromArca(cuit: string, name: string, avg: string, category = "otros"): Promise<R> {
  const s = await requireOrg();
  if (!can(s.org.role) || !/^\d{11}$/.test(cuit)) return { ok: false, error: "No permitido" };
  const { error } = await s.supabase.from("fixed_costs").insert({
    org_id: s.org.org_id, name: name.slice(0, 120) || cuit, category: /^[a-z]{3,20}$/.test(category) ? category : "otros", amount: Math.max(0, Number(avg) || 0).toFixed(2),
    source: "arca", supplier_cuit: cuit, created_by: s.userId,
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return done();
}

/** Marca un gasto del mes como pagado (crea el registro del mes si no había factura). */
export async function setMonthPaid(costId: string, period: string, paid: boolean, amount: string, billId?: string): Promise<R> {
  const s = await requireOrg();
  if (!can(s.org.role) || !isUuid(costId) || !/^\d{4}-\d{2}$/.test(period)) return { ok: false, error: "No permitido" };
  const today = new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
  const { error } = billId && isUuid(billId)
    ? await s.supabase.from("fixed_cost_bills").update({ paid, paid_at: paid ? today : null }).eq("id", billId).eq("org_id", s.org.org_id)
    : await s.supabase.from("fixed_cost_bills").insert({ org_id: s.org.org_id, cost_id: costId, dedupe_key: `manual|${costId}|${period}`, period, amount: Number(amount) || null, paid, paid_at: paid ? today : null, source: "manual" });
  if (error) return { ok: false, error: friendlyDbError(error) };
  return done();
}

/** Regla por destinatario: corregir rubro, marcar como personal (no cuenta) o "no es gasto fijo". */
export async function setPayeeRule(payeeKey: string, rule: { category?: string | null; ignore?: boolean; not_fixed?: boolean }): Promise<R> {
  const s = await requireOrg();
  if (!can(s.org.role) || !payeeKey || payeeKey.length > 60) return { ok: false, error: "No permitido" };
  if (rule.category && !(CATS as readonly string[]).concat(["comida", "ferreteria", "proveedores", "compras", "honorarios"]).includes(rule.category)) return { ok: false, error: "Rubro inválido" };
  const { data: prev } = await s.supabase.from("payee_rules").select("*").eq("org_id", s.org.org_id).eq("payee_key", payeeKey).maybeSingle();
  const { error } = await s.supabase.from("payee_rules").upsert({
    org_id: s.org.org_id, payee_key: payeeKey, category: rule.category !== undefined ? rule.category : prev?.category ?? null,
    ignore: rule.ignore ?? prev?.ignore ?? false, not_fixed: rule.not_fixed ?? prev?.not_fixed ?? false, updated_at: new Date().toISOString(),
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  if (rule.ignore || rule.not_fixed) {
    await s.supabase.from("fixed_costs").update({ active: false }).eq("org_id", s.org.org_id).eq("provider_key", "pago").eq("account_ref", payeeKey);
  }
  await s.supabase.rpc("redetect_fixed", { p_org: s.org.org_id });
  return done();
}
