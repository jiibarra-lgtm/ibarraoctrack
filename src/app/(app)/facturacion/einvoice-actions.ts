"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg } from "@/lib/session";
import { canBill } from "@/lib/billing";
import { isUuid } from "@/lib/utils";
import { arcaAuth, getVoucher, lastVoucher, requestCae, type ArcaRpc } from "@/lib/arca";
import { computeTotals, fmtVoucher, fromYmd, IVA_CONDITIONS, VOUCHER_TYPE, type AssocRemito, type EInvoiceLine, type EInvoiceSettings, type SaleCondition } from "@/lib/einvoice";

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
  customer: { id: string | null; name: string; cuit: string | null; address: string | null; iva_condition: number | null; sale_condition_id: string | null };
  items: { id: string; line: number; description: string; quantity: number; unit: string | null; unit_price: number; total: number }[];
};

export type PendingRemito = {
  id: string; label: string; provisional: boolean; point_of_sale: number | null; number: number | null; issued_at: string;
  items: { description: string; quantity: number; unit_price: number | null; purchase_order_item_id: string | null }[];
};

/** Remitos del sistema de una OC que todavía no se facturaron (para facturar varios juntos). */
export async function loadPendingRemitos(poId: string): Promise<R<{ remitos: PendingRemito[] }>> {
  try {
    if (!isUuid(poId)) return { ok: false, error: "Orden inválida" };
    const s = await requireOrg();
    const { data, error } = await s.supabase.from("remitos")
      .select("id, point_of_sale, number, provisional, issued_at, status, remito_items(description, quantity, unit_price, purchase_order_item_id, line_no)")
      .eq("org_id", s.org.org_id).eq("purchase_order_id", poId).is("invoice_emission_id", null).neq("status", "anulado").order("issued_at");
    if (error) return { ok: false, error: error.message };
    type Row = { id: string; point_of_sale: number | null; number: number | null; provisional: boolean; issued_at: string; remito_items: { description: string; quantity: string; unit_price: string | null; purchase_order_item_id: string | null; line_no: number }[] };
    const remitos = ((data ?? []) as Row[]).map((r) => ({
      id: r.id, provisional: r.provisional, point_of_sale: r.point_of_sale, number: r.number, issued_at: r.issued_at,
      label: r.number ? `${r.provisional ? "Prov. " : ""}${String(r.point_of_sale ?? 0).padStart(4, "0")}-${String(r.number).padStart(8, "0")}` : "Sin número",
      items: [...r.remito_items].sort((a, b) => a.line_no - b.line_no).map((i) => ({ description: i.description, quantity: Number(i.quantity), unit_price: i.unit_price === null ? null : Number(i.unit_price), purchase_order_item_id: i.purchase_order_item_id })),
    }));
    return { ok: true, remitos };
  } catch (e) { return fail(e); }
}

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
  sale_condition_id: z.string().uuid({ message: "Elegí la condición de venta" }),
  payment_due: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha de vencimiento inválida"),
  concept: z.union([z.literal(1), z.literal(2), z.literal(3)]),
  service_from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  service_to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  remitos: z.array(z.object({
    pv: z.number().int().min(1, "Punto de venta del remito inválido").max(99999),
    number: z.number().int().min(1, "Número de remito inválido").max(99999999),
    date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable(),
  })).max(20).default([]),
  remito_ids: z.array(z.string().uuid()).max(50).default([]),
});

type Sale = { condition: SaleCondition | null; label: string | null; kind: string | null; due: string | null; concept: 1 | 2 | 3; service: { from: string; to: string; due: string } | null };

/** Condiciones de venta activas (la predeterminada primero). */
export async function listSaleConditions(): Promise<R<{ conditions: SaleCondition[] }>> {
  try {
    const s = await requireOrg();
    const { data, error } = await s.supabase.from("sale_conditions").select("id, code, name, arca_kind, days, is_default, active, notes")
      .eq("org_id", s.org.org_id).eq("active", true).order("is_default", { ascending: false }).order("code");
    if (error) return { ok: false, error: error.message };
    return { ok: true, conditions: (data ?? []) as SaleCondition[] };
  } catch (e) { return fail(e); }
}
export type EInvoiceInput = z.input<typeof Input>;

/** Datos fijos de facturación (receptor GCBA, condición, concepto). null si no se configuraron. */
export async function loadEInvoiceSettings(): Promise<R<{ settings: EInvoiceSettings | null }>> {
  try {
    const s = await requireOrg();
    const { data } = await s.supabase.from("einvoice_settings")
      .select("fixed_receiver, receiver_cuit, receiver_name, receiver_address, iva_condition, sale_condition_id, concept, require_remito, remito_pv")
      .eq("org_id", s.org.org_id).maybeSingle();
    return { ok: true, settings: (data as EInvoiceSettings | null) ?? null };
  } catch (e) { return fail(e); }
}

async function emit(
  { s, rpc }: Awaited<ReturnType<typeof ctx>>,
  p: { kind: "factura" | "nota_credito"; letter: "A" | "B"; receiver: { name: string; cuit: string; address: string | null; iva: number };
    totals: ReturnType<typeof computeTotals>; pricesIncludeVat: boolean; poId: string | null; customerId: string | null; notes: string | null;
    associated?: { id: string; type: number; pv: number; number: number; date: string }; sale: Sale; remitos?: AssocRemito[]; fixed?: boolean; remitoIds?: string[] },
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
    concept: p.sale.concept, service: p.sale.service,
  };
  let cae: string, caeDue: string | null, observations: string[] = [];
  // Rechazos de ARCA quedan registrados para avisar en Facturación e Impuestos
  const logAttempt = (msg: string) => s.supabase.from("einvoice_attempts").insert({
    org_id: s.org.org_id, kind: p.kind, receiver: `${p.receiver.name} (${p.receiver.cuit})`.slice(0, 200), total: p.totals.total.toFixed(2), error: msg.slice(0, 1000), created_by: s.userId,
  }).then(() => null, () => null);
  try {
    const r = await requestCae(auth, req);
    if (!r.ok) throw Object.assign(new Error(`ARCA rechazó el comprobante: ${r.error}`), { rejected: true });
    cae = r.cae; caeDue = fromYmd(r.caeDue); observations = r.observations;
  } catch (e) {
    if ((e as { rejected?: boolean }).rejected) { await logAttempt((e as Error).message); throw e; }
    // Se cortó la conexión: puede que ARCA lo haya autorizado igual. Se consulta antes de reintentar.
    const v = await getVoucher(auth, pv, type, number).catch(() => null);
    if (!v?.cae || Math.abs(v.total - p.totals.total) > 0.01 || v.docNumber !== p.receiver.cuit) {
      await logAttempt(`Sin confirmar: ${(e as Error).message}`);
      throw new Error(`No se pudo confirmar con ARCA: ${(e as Error).message}. Revisá en unos minutos antes de volver a intentar.`);
    }
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
      sale_condition_id: p.sale.condition?.id ?? null, sale_condition: p.sale.label, payment_kind: p.sale.kind, payment_due: p.sale.due,
      concept: p.sale.concept, service_from: p.sale.service?.from ?? null, service_to: p.sale.service?.to ?? null,
      remitos: p.remitos ?? [], fixed_receiver: !!p.fixed, remito_ids: p.remitoIds ?? [],
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
    // Receptor fijo (como se factura en ARCA): se usa siempre el configurado, no lo que venga del formulario
    const { data: cfg } = await c.s.supabase.from("einvoice_settings")
      .select("fixed_receiver, receiver_cuit, receiver_name, receiver_address, iva_condition, require_remito").eq("org_id", c.s.org.org_id).maybeSingle();
    const fixed = !!cfg?.fixed_receiver;
    if (fixed) {
      f.receiver_cuit = cfg!.receiver_cuit; f.receiver_name = cfg!.receiver_name; f.receiver_address = cfg!.receiver_address; f.iva_condition = cfg!.iva_condition;
    }
    if (cfg?.require_remito && !f.remitos.length) return { ok: false, error: "Falta el N° de remito oficial (Comprobantes asociados → Remito R)" };
    if (f.remito_ids.length) {
      if (!f.purchase_order_id) return { ok: false, error: "Los remitos se facturan desde su orden de compra" };
      const { data: rs } = await c.s.supabase.from("remitos").select("id, purchase_order_id, invoice_emission_id, status").eq("org_id", c.s.org.org_id).in("id", f.remito_ids);
      const bad = (rs ?? []).find((r) => r.purchase_order_id !== f.purchase_order_id || r.invoice_emission_id || r.status === "anulado");
      if ((rs ?? []).length !== f.remito_ids.length || bad) return { ok: false, error: "Alguno de los remitos ya se facturó, se anuló o es de otra orden. Volvé a abrir la factura." };
    }
    const seen = new Set<string>();
    for (const r of f.remitos) { const k = `${r.pv}-${r.number}`; if (seen.has(k)) return { ok: false, error: `El remito ${k} está repetido` }; seen.add(k); }
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
    const { data: sc } = await c.s.supabase.from("sale_conditions").select("id, code, name, arca_kind, days, is_default, active, notes")
      .eq("id", f.sale_condition_id).eq("org_id", c.s.org.org_id).maybeSingle();
    if (!sc) return { ok: false, error: "Condición de venta inexistente" };
    const issue = today();
    if (f.payment_due < issue) return { ok: false, error: "El vencimiento de pago no puede ser anterior a hoy" };
    let service: Sale["service"] = null;
    if (f.concept !== 1) {
      if (!f.service_from || !f.service_to) return { ok: false, error: "Para servicios, ARCA pide el período facturado (desde / hasta)" };
      if (f.service_from > f.service_to) return { ok: false, error: "El período facturado está al revés" };
      service = { from: f.service_from, to: f.service_to, due: f.payment_due };
    }
    const cond = sc as SaleCondition;
    const r = await emit(c, {
      kind: "factura", letter, receiver: { name: f.receiver_name, cuit: f.receiver_cuit, address: f.receiver_address, iva: f.iva_condition },
      totals, pricesIncludeVat: f.prices_include_vat, poId: f.purchase_order_id, customerId: f.customer_id, notes: f.notes,
      sale: { condition: cond, label: cond.name, kind: cond.arca_kind, due: f.payment_due, concept: f.concept, service },
      remitos: f.remitos, fixed, remitoIds: f.remito_ids,
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
      // la nota de crédito repite la condición y el concepto de la factura que anula
      sale: {
        condition: null, label: e.sale_condition ?? null, kind: e.payment_kind ?? null, due: today(), concept: (e.concept ?? 1) as 1 | 2 | 3,
        service: e.concept && e.concept !== 1 && e.service_from && e.service_to ? { from: e.service_from, to: e.service_to, due: today() } : null,
      },
      remitos: (e.remitos ?? []) as AssocRemito[], fixed: true,
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
