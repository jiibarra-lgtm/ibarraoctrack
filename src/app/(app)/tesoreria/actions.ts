"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg } from "@/lib/session";
import { canBill } from "@/lib/billing";
import { friendlyDbError } from "@/lib/errors";
import { isUuid } from "@/lib/utils";
import { cashCountAdjustment, chequeNext, type ChequeDirection, type ChequeStatus } from "@/lib/treasury";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: (e as Error).message || "Error inesperado" });
const today = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);
const ymd = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");

async function guard() {
  const s = await requireOrg();
  if (!canBill(s.org.role)) throw new Error("Sólo administración y finanzas");
  return s;
}
const refresh = () => { for (const p of ["/tesoreria/cheques", "/tesoreria/caja", "/tesoreria/conciliacion", "/tesoreria/flujo", "/contabilidad"]) revalidatePath(p); };

// ---------------------------------------------------------------------------
// Cheques
// ---------------------------------------------------------------------------
const Cheque = z.object({
  id: z.string().uuid().nullable(),
  direction: z.enum(["recibido", "emitido"]),
  kind: z.enum(["fisico", "echeq"]),
  bank: z.string().trim().max(80).nullable(),
  number: z.string().trim().max(40).nullable(),
  counterpart_name: z.string().trim().min(2, "Poné de quién es (o a quién se lo das)").max(200),
  counterpart_cuit: z.string().transform((x) => x.replace(/\D/g, "")).refine((x) => !x || /^\d{11}$/.test(x), "El CUIT tiene que tener 11 números").nullable(),
  amount: z.number().positive("El importe tiene que ser mayor a cero").max(1e12),
  issue_date: ymd,
  pay_date: ymd,
  purchase_order_id: z.string().uuid().nullable(),
  notes: z.string().trim().max(500).nullable(),
});

export async function saveCheque(input: z.input<typeof Cheque>): Promise<R> {
  try {
    const s = await guard();
    const p = Cheque.safeParse(input);
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
    const v = p.data;
    if (v.pay_date < v.issue_date) return { ok: false, error: "La fecha de pago no puede ser anterior a la de emisión" };
    const row = { ...v, counterpart_cuit: v.counterpart_cuit || null, bank: v.bank || null, number: v.number || null, notes: v.notes || null, org_id: s.org.org_id, updated_at: new Date().toISOString() };
    delete (row as { id?: string | null }).id;
    const { error } = v.id
      ? await s.supabase.from("cheques").update(row).eq("id", v.id).eq("org_id", s.org.org_id)
      : await s.supabase.from("cheques").insert({ ...row, status: v.direction === "recibido" ? "cartera" : "emitido", status_date: v.issue_date });
    if (error) return { ok: false, error: friendlyDbError(error) };
    refresh();
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function setChequeStatus(id: string, status: ChequeStatus, opts: { date?: string; endorsed_to?: string } = {}): Promise<R> {
  try {
    const s = await guard();
    if (!isUuid(id)) return { ok: false, error: "Cheque inválido" };
    const { data: c } = await s.supabase.from("cheques").select("direction, status").eq("id", id).eq("org_id", s.org.org_id).maybeSingle();
    if (!c) return { ok: false, error: "Cheque inexistente" };
    if (!chequeNext(c.direction as ChequeDirection, c.status as ChequeStatus).includes(status)) return { ok: false, error: "Ese cambio de estado no corresponde" };
    if (status === "endosado" && !opts.endorsed_to?.trim()) return { ok: false, error: "Poné a quién se lo endosaste" };
    const date = opts.date && /^\d{4}-\d{2}-\d{2}$/.test(opts.date) ? opts.date : today();
    const patch: Record<string, unknown> = { status, status_date: date, updated_at: new Date().toISOString() };
    if (status === "endosado") patch.endorsed_to = opts.endorsed_to!.trim().slice(0, 200);
    if (status === "cartera") { patch.endorsed_to = null; patch.bank_movement_id = null; }
    const { error } = await s.supabase.from("cheques").update(patch).eq("id", id).eq("org_id", s.org.org_id);
    if (error) return { ok: false, error: friendlyDbError(error) };
    refresh();
    return { ok: true };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// Caja
// ---------------------------------------------------------------------------
const Cash = z.object({
  mov_date: ymd,
  direction: z.enum(["in", "out"]),
  amount: z.number().positive("El importe tiene que ser mayor a cero").max(1e12),
  category: z.enum(["venta", "proveedor", "gasto", "retiro", "aporte", "banco", "arqueo", "otro"]),
  concept: z.string().trim().min(2, "Poné un concepto").max(200),
  reference: z.string().trim().max(100).nullable(),
});

export async function saveCashMovement(input: z.input<typeof Cash>): Promise<R> {
  try {
    const s = await guard();
    const p = Cash.safeParse(input);
    if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
    if (p.data.mov_date > today()) return { ok: false, error: "La fecha no puede ser futura" };
    const { error } = await s.supabase.from("cash_movements").insert({ ...p.data, reference: p.data.reference || null, org_id: s.org.org_id });
    if (error) return { ok: false, error: friendlyDbError(error) };
    refresh();
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function deleteCashMovement(id: string): Promise<R> {
  try {
    const s = await guard();
    if (!isUuid(id)) return { ok: false, error: "Movimiento inválido" };
    const { error } = await s.supabase.from("cash_movements").delete().eq("id", id).eq("org_id", s.org.org_id);
    if (error) return { ok: false, error: friendlyDbError(error) };
    refresh();
    return { ok: true };
  } catch (e) { return fail(e); }
}

/** Arqueo: contás la plata y, si no coincide con el sistema, queda registrado el ajuste. */
export async function cashCount(counted: number): Promise<R<{ adjusted: number }>> {
  try {
    const s = await guard();
    if (!Number.isFinite(counted) || counted < 0) return { ok: false, error: "Importe contado inválido" };
    const { data } = await s.supabase.from("cash_movements").select("direction, amount").eq("org_id", s.org.org_id).limit(100000);
    const bal = (data ?? []).reduce((a, m) => a + (m.direction === "in" ? 1 : -1) * Number(m.amount), 0);
    const adj = cashCountAdjustment(bal, counted);
    if (!adj) return { ok: true, adjusted: 0 };
    const { error } = await s.supabase.from("cash_movements").insert({
      org_id: s.org.org_id, mov_date: today(), direction: adj.direction, amount: adj.amount, category: "arqueo",
      concept: `Arqueo: contado ${counted.toFixed(2)}, sistema ${bal.toFixed(2)}`,
    });
    if (error) return { ok: false, error: friendlyDbError(error) };
    refresh();
    return { ok: true, adjusted: adj.direction === "in" ? adj.amount : -adj.amount };
  } catch (e) { return fail(e); }
}

// ---------------------------------------------------------------------------
// Conciliación bancaria
// ---------------------------------------------------------------------------
const RECON_KINDS = ["cobro", "pago_proveedor", "gasto_fijo", "cheque", "caja", "impuesto", "banco", "titular", "otro"] as const;

/** Concilia un movimiento del banco con lo que corresponde. Si es un cheque o un gasto fijo, los marca también. */
export async function reconcileMovement(movementId: string, kind: (typeof RECON_KINDS)[number], refId: string | null, note: string | null): Promise<R> {
  try {
    const s = await guard();
    if (!isUuid(movementId) || !RECON_KINDS.includes(kind) || (refId && !isUuid(refId))) return { ok: false, error: "Datos inválidos" };
    const org = s.org.org_id;
    const { data: mov } = await s.supabase.from("bank_movements").select("id, mov_date, amount, direction").eq("id", movementId).eq("org_id", org).maybeSingle();
    if (!mov) return { ok: false, error: "Movimiento inexistente" };
    if (kind === "otro" && !note?.trim()) return { ok: false, error: "Contá qué es en una nota" };
    if (kind === "cheque" && refId) {
      const { data: c } = await s.supabase.from("cheques").select("direction, status").eq("id", refId).eq("org_id", org).maybeSingle();
      if (!c) return { ok: false, error: "Cheque inexistente" };
      const status = c.direction === "emitido" ? "debitado" : "acreditado";
      if (!["emitido", "depositado", "cartera"].includes(c.status)) return { ok: false, error: `El cheque está ${c.status}` };
      await s.supabase.from("cheques").update({ status, status_date: mov.mov_date, bank_movement_id: movementId, updated_at: new Date().toISOString() }).eq("id", refId).eq("org_id", org);
    }
    if (kind === "gasto_fijo" && refId) {
      await s.supabase.from("fixed_cost_bills").update({ paid: true, paid_at: mov.mov_date, bank_movement_id: movementId }).eq("id", refId).eq("org_id", org);
    }
    const { error } = await s.supabase.from("bank_reconciliations").upsert({ bank_movement_id: movementId, org_id: org, kind, ref_id: refId, note: note?.trim().slice(0, 300) || null });
    if (error) return { ok: false, error: friendlyDbError(error) };
    await s.supabase.from("bank_movements").update({ reconciled_at: new Date().toISOString() }).eq("id", movementId).eq("org_id", org);
    refresh();
    revalidatePath("/banco");
    return { ok: true };
  } catch (e) { return fail(e); }
}

export async function unreconcileMovement(movementId: string): Promise<R> {
  try {
    const s = await guard();
    if (!isUuid(movementId)) return { ok: false, error: "Datos inválidos" };
    const org = s.org.org_id;
    const { data: r } = await s.supabase.from("bank_reconciliations").select("kind, ref_id").eq("bank_movement_id", movementId).eq("org_id", org).maybeSingle();
    if (r?.kind === "cheque" && r.ref_id) {
      const { data: c } = await s.supabase.from("cheques").select("direction").eq("id", r.ref_id).eq("org_id", org).maybeSingle();
      if (c) await s.supabase.from("cheques").update({ status: c.direction === "emitido" ? "emitido" : "depositado", bank_movement_id: null }).eq("id", r.ref_id).eq("org_id", org);
    }
    if (r?.kind === "gasto_fijo" && r.ref_id) await s.supabase.from("fixed_cost_bills").update({ bank_movement_id: null }).eq("id", r.ref_id).eq("org_id", org);
    await s.supabase.from("bank_reconciliations").delete().eq("bank_movement_id", movementId).eq("org_id", org);
    await s.supabase.from("bank_movements").update({ reconciled_at: null }).eq("id", movementId).eq("org_id", org);
    refresh();
    revalidatePath("/banco");
    return { ok: true };
  } catch (e) { return fail(e); }
}
