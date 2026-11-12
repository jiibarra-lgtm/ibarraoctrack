"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg } from "@/lib/session";
import { canBill } from "@/lib/billing";
import { isUuid } from "@/lib/utils";
import { arcaAuth, getVoucher, lastVoucher, requestCae, type ArcaRpc } from "@/lib/arca";
import { computeTotals, fmtVoucher, fromYmd, IVA_CONDITIONS, VOUCHER_TYPE, type EInvoiceLine } from "@/lib/einvoice";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown): { ok: false; error: string } => ({ ok: false, error: (e as Error).message || "Error inesperado" });
const today = () => new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10);

async function ctx() {
  const s = await requireOrg();
  if (!canBill(s.org.role)) throw new Error("Sólo administración y finanzas pueden facturar");
  const rpc: ArcaRpc = async (action, data = {}) => {
    const { data: d, error } = await s.supabase.rpc("arca_conn", { p_action: action, p_org: s.org.org_id, p_data: data });
    if (error) throw new Error(error.message);
    return (d ?? {}) as Record<string, unknown>;
  };
  return { s, rpc };
}

export type OrderForInvoice = {
  id: string; label: string; currency: string; status: string; order_total: number; invoiced: number;
  customer: { id: string | null; name: string; cuit: string | null; address: string | null; iva_condition: number | null };
  items: { id: string; line: number; description: string; quantity: number; unit: string | null; unit_price: number; total: number }[];
};

export async function loadOrderForInvoice(poId: string): Promise<R<{ order: OrderForInvoice }>> {
  try {
    if (!isUuid(poId)) return { ok: false, error: "Orden inválida" };
    const { s } = await ctx();
    const { data, error } = await s.supabase.rpc("einvoice_order", { p_org: s.org.org_id, p_po: poId });
    if (error) return { ok: false, error: error.message };
    const o = data as OrderForInvoice;
    return { ok: true, order: { ...o, order_total: Number(o.order_total), invoiced: Number(o.invoiced), items: o.items.map((i) => ({ ...i, quantity: Number(i.quantity), unit_price: Number(i.unit_price), total: Number(i.total) })) } };
  } catch (e) { return fail(e); }
}

const Line = z.object({
  description: z.string().trim().min(1).max(300),
  quantity: z.number().positive().max(1e9),
  unit: z.string().max(30).nullable(),
  unit_price: z.number().min(0).max(1e12),
  vat_rate: z.union([z.literal(21), z.literal(10.5), z.literal(27), z.literal(0)]),
});
const Input = z.object({
  purchase_order_id: z.string().uuid().nullable(),
  customer_id: z.string().uuid().nullable(),
  receiver_name: z.string().trim().min(2).max(200),
  receiver_cuit: z.string().transform((s) => s.replace(/\D/g, "")).refine((s) => /^\d{11}$/.test(s), "El CUIT del cliente tiene que tener 11 números"),
  receiver_address: z.string().trim().max(300).nullable(),
  iva_condition: z.number().int().refine((n) => n in IVA_CONDITIONS, "Condición de IVA inválida"),
  prices_include_vat: z.boolean(),
  lines: z.array(Line).min(1).max(200),
  notes: z.string().max(1000).nullable(),
});
export type EInvoiceInput = z.infer<typeof Input>;

async function emit(
  { s, rpc }: Awaited<ReturnType<typeof ctx>>,
  p: { kind: "factura" | "nota_credito"; letter: "A" | "B"; receiver: { name: string; cuit: string; address: string | null; iva: number };
    totals: ReturnType<typeof computeTotals>; pricesIncludeVat: boolean; poId: string | null; customerId: string | null; notes: string | null;
    associated?: { id: string; type: number; pv: number; number: number; date: string } },
) {
  const auth = await arcaAuth(rpc);
  if (!auth.pointOfSale) throw new Error("Falta el punto de venta en Configuración → ARCA");
  const type = VOUCHER_TYPE[p.letter][p.kind];
  const pv = auth.pointOfSale;
  const number = (await lastVoucher(auth, pv, type)) + 1;
  const date = today();
  const req = {
    pointOfSale: pv, type, number, date, docType: 80, docNumber: p.receiver.cuit, ivaCondition: p.receiver.iva,
    net: p.totals.net, vatTotal: p.totals.vat_total, total: p.totals.total, vat: p.totals.vat,
    associated: p.associated ? { type: p.associated.type, pointOfSale: p.associated.pv, number: p.associated.number, cuit: auth.cuit, date: p.associated.date } : null,
  };
  let cae: string, caeDue: string | null, observations: string[] = [];
  try {
    const r = await requestCae(auth, req);
    if (!r.ok) throw Object.assign(new Error(`ARCA rechazó el comprobante: ${r.error}`), { rejected: true });
    cae = r.cae; caeDue = fromYmd(r.caeDue); observations = r.observations;
  } catch (e) {
    if ((e as { rejected?: boolean }).rejected) throw e;
    // Se cortó la conexión: puede que ARCA lo haya autorizado igual. Se consulta antes de reintentar.
    const v = await getVoucher(auth, pv, type, number).catch(() => null);
    if (!v?.cae || Math.abs(v.total - p.totals.total) > 0.01 || v.docNumber !== p.receiver.cuit) throw new Error(`No se pudo confirmar con ARCA: ${(e as Error).message}. Revisá en unos minutos antes de volver a intentar.`);
    cae = v.cae; caeDue = fromYmd(v.caeDue);
  }
  const { data: id, error } = await s.supabase.rpc("einvoice_record", {
    p_org: s.org.org_id,
    p_e: {
      kind: p.kind, voucher_type: type, point_of_sale: pv, number, issue_date: date, cae, cae_due: caeDue, doc_type: 80, doc_number: p.receiver.cuit,
      receiver_name: p.receiver.name, receiver_address: p.receiver.address, iva_condition: p.receiver.iva,
      net: p.totals.net, vat: p.totals.vat_total, total: p.totals.total, vat_detail: p.totals.vat, lines: p.totals.lines,
      prices_include_vat: p.pricesIncludeVat, purchase_order_id: p.poId, customer_id: p.customerId, associated_id: p.associated?.id ?? null,
      notes: p.notes, observations: observations.join(" · ") || null,
    },
  });
  if (error) throw new Error(`ARCA autorizó ${fmtVoucher(type, pv, number)} (CAE ${cae}) pero no se pudo guardar: ${error.message}. Avisá antes de volver a emitir.`);
  return { id: String(id), label: fmtVoucher(type, pv, number), cae };
}

/** Emite una factura A o B con CAE. Si es de una OC, queda registrada en su facturación. */
export async function emitEInvoice(raw: EInvoiceInput): Promise<R<{ id: string; label: string; cae: string }>> {
  try {
    const parsed = Input.safeParse(raw);
    if (!parsed.success) return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos" };
    const f = parsed.data;
    const c = await ctx();
    const totals = computeTotals(f.lines as EInvoiceLine[], f.prices_include_vat);
    if (totals.total <= 0) return { ok: false, error: "El total tiene que ser mayor a cero" };
    if (f.purchase_order_id) {
      const { data } = await c.s.supabase.rpc("einvoice_order", { p_org: c.s.org.org_id, p_po: f.purchase_order_id });
      const o = data as { order_total: number; invoiced: number; status: string; currency: string } | null;
      if (!o) return { ok: false, error: "Orden inexistente" };
      if (o.status === "anulada") return { ok: false, error: "La orden está anulada" };
      if (o.currency !== "ARS") return { ok: false, error: "Por ahora sólo se factura en pesos" };
      const left = Number(o.order_total) - Number(o.invoiced);
      if (totals.total > left + 1) return { ok: false, error: `El total (${totals.total.toFixed(2)}) supera lo que falta facturar de la orden (${left.toFixed(2)})` };
      // doble clic / reintento: misma OC y mismo total en los últimos 3 minutos
      const { data: dup } = await c.s.supabase.from("arca_emissions").select("id").eq("org_id", c.s.org.org_id).eq("purchase_order_id", f.purchase_order_id)
        .eq("kind", "factura").eq("total", totals.total.toFixed(2)).gte("created_at", new Date(Date.now() - 180_000).toISOString()).limit(1);
      if (dup?.length) return { ok: false, error: "Esa factura ya se emitió hace un momento" };
    }
    const letter = IVA_CONDITIONS[f.iva_condition].letter;
    const r = await emit(c, {
      kind: "factura", letter, receiver: { name: f.receiver_name, cuit: f.receiver_cuit, address: f.receiver_address, iva: f.iva_condition },
      totals, pricesIncludeVat: f.prices_include_vat, poId: f.purchase_order_id, customerId: f.customer_id, notes: f.notes,
    });
    revalidatePath("/facturacion");
    if (f.purchase_order_id) revalidatePath(`/ordenes/${f.purchase_order_id}`);
    revalidatePath("/impuestos");
    return { ok: true, ...r };
  } catch (e) { return fail(e); }
}

/** Anula una factura con una nota de crédito por el total (mismos renglones). */
export async function emitCreditNote(emissionId: string): Promise<R<{ id: string; label: string; cae: string }>> {
  try {
    if (!isUuid(emissionId)) return { ok: false, error: "Comprobante inválido" };
    const c = await ctx();
    const { data: e } = await c.s.supabase.from("arca_emissions_overview").select("*").eq("id", emissionId).eq("org_id", c.s.org.org_id).maybeSingle();
    if (!e) return { ok: false, error: "Comprobante inexistente" };
    if (e.kind !== "factura") return { ok: false, error: "Sólo se anulan facturas" };
    if (e.credit_note_id) return { ok: false, error: "Esta factura ya tiene nota de crédito" };
    const lines = (e.lines as (EInvoiceLine & { amount: number })[]).map((l) => ({ description: l.description, quantity: Number(l.quantity), unit: l.unit, unit_price: Number(l.unit_price), vat_rate: Number(l.vat_rate) }));
    const totals = computeTotals(lines, e.prices_include_vat);
    if (Math.abs(totals.total - Number(e.total)) > 0.02) return { ok: false, error: "No se pudo rearmar el total de la factura" };
    const r = await emit(c, {
      kind: "nota_credito", letter: e.voucher_type === 1 ? "A" : "B",
      receiver: { name: e.receiver_name, cuit: e.doc_number, address: e.receiver_address, iva: e.iva_condition },
      totals, pricesIncludeVat: e.prices_include_vat, poId: e.purchase_order_id, customerId: e.customer_id, notes: `Anula ${fmtVoucher(e.voucher_type, e.point_of_sale, Number(e.number))}`,
      associated: { id: e.id, type: e.voucher_type, pv: e.point_of_sale, number: Number(e.number), date: e.issue_date },
    });
    revalidatePath("/facturacion");
    revalidatePath("/impuestos");
    return { ok: true, ...r };
  } catch (e) { return fail(e); }
}

/** Busca el cliente en el padrón de ARCA por CUIT (razón social, domicilio y condición de IVA). */
export async function lookupCustomerCuit(cuit: string): Promise<R<{ name: string; address: string | null; iva_condition: number }>> {
  try {
    const clean = cuit.replace(/\D/g, "");
    if (!/^\d{11}$/.test(clean)) return { ok: false, error: "El CUIT tiene que tener 11 números" };
    const { s } = await ctx();
    const { lookupPersona } = await import("@/lib/tax-sync");
    const p = await lookupPersona(s.supabase, s.org.org_id, clean);
    return { ok: true, name: p.name, address: p.address, iva_condition: p.ivaCondition };
  } catch (e) { return fail(e); }
}
