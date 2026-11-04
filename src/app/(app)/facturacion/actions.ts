"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg } from "@/lib/session";
import { friendlyDbError } from "@/lib/errors";
import { parseArNumber } from "@/lib/money";
import { isUuid } from "@/lib/utils";
import { canBill, invoiceLabel } from "@/lib/billing";
import { formatMoney } from "@/lib/format";
import { readOwnInvoice, type OwnInvoiceDraft } from "@/lib/invoice/read-own";

type Res<T = unknown> = { ok: true; data?: T } | { ok: false; error: string };

const money = (required = false) =>
  z.string().trim().transform((v, ctx) => {
    if (!v) {
      if (required) ctx.addIssue({ code: "custom", message: "Importe requerido" });
      return "0";
    }
    const n = parseArNumber(v);
    if (n === null || Number(n) < 0) { ctx.addIssue({ code: "custom", message: `Importe inválido: ${v}` }); return "0"; }
    return n;
  });
const isoDate = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida");

function refresh(poId?: string | null) {
  ["/facturacion", "/cobranzas", "/finanzas", "/dashboard", "/alertas"].forEach((p) => revalidatePath(p));
  if (poId) revalidatePath(`/ordenes/${poId}`);
}

async function billingSession() {
  const s = await requireOrg();
  if (!canBill(s.org.role)) return { s, error: "Sólo administración o finanzas pueden facturar y registrar cobros." };
  return { s, error: null };
}

const invoiceSchema = z.object({
  purchase_order_id: z.string().uuid("Elegí la orden"),
  invoice_type: z.enum(["A", "B", "C", "M", "E"]).default("B"),
  point_of_sale: z.string().trim().regex(/^\d{0,5}$/, "Punto de venta inválido").transform((v) => (v ? String(Number(v)) : null)),
  number: z.string().trim().regex(/^\d{0,8}$/, "Número inválido").transform((v) => (v ? String(Number(v)) : null)),
  issue_date: isoDate,
  due_date: z.string().trim().transform((v) => v || null).pipe(isoDate.nullable()),
  net_amount: money(), vat_amount: money(), other_taxes: money(), total_amount: money(true),
  cae: z.string().trim().max(20).transform((v) => v || null),
  document_id: z.string().trim().transform((v) => v || null).pipe(z.string().uuid().nullable()),
  notes: z.string().trim().max(2000).transform((v) => v || null),
});
export type InvoiceInput = z.input<typeof invoiceSchema>;

export async function createInvoice(input: InvoiceInput): Promise<Res<{ id: string }>> {
  const { s, error } = await billingSession();
  if (error) return { ok: false, error };
  const p = invoiceSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  if (Number(p.data.total_amount) <= 0) return { ok: false, error: "El total tiene que ser mayor a cero." };
  const { data, error: e } = await s.supabase.from("sales_invoices")
    .insert({ ...p.data, org_id: s.org.org_id, created_by: s.userId }).select("id").single();
  if (e) return { ok: false, error: friendlyDbError(e) };
  if (p.data.document_id) {
    await s.supabase.from("documents").update({ doc_type: "factura_emitida", purchase_order_id: p.data.purchase_order_id }).eq("id", p.data.document_id);
  }
  refresh(p.data.purchase_order_id);
  return { ok: true, data: { id: data.id } };
}

export async function voidInvoice(id: string, reason: string): Promise<Res> {
  const { s, error } = await billingSession();
  if (error) return { ok: false, error };
  if (!isUuid(id) || reason.trim().length < 3) return { ok: false, error: "Indicá el motivo de la anulación." };
  const { data, error: e } = await s.supabase.from("sales_invoices").update({ status: "anulada", void_reason: reason.trim() })
    .eq("id", id).eq("org_id", s.org.org_id).select("purchase_order_id").maybeSingle();
  if (e || !data) return { ok: false, error: e ? friendlyDbError(e) : "Factura no encontrada" };
  refresh(data.purchase_order_id);
  return { ok: true };
}

const collectionSchema = z.object({
  invoice_id: z.string().uuid(),
  payment_date: isoDate,
  amount_received: money(),
  ret_iibb: money(), ret_ganancias: money(), ret_iva: money(), ret_suss: money(), ret_otras: money(),
  method: z.enum(["transferencia", "cheque", "echeq", "efectivo", "otro"]).default("transferencia"),
  reference: z.string().trim().max(120).transform((v) => v || null),
  notes: z.string().trim().max(2000).transform((v) => v || null),
});
export type CollectionInput = z.input<typeof collectionSchema>;

export async function createCollection(input: CollectionInput): Promise<Res> {
  const { s, error } = await billingSession();
  if (error) return { ok: false, error };
  const p = collectionSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0].message };
  const { data: inv } = await s.supabase.from("sales_invoices").select("purchase_order_id").eq("id", p.data.invoice_id).eq("org_id", s.org.org_id).maybeSingle();
  if (!inv) return { ok: false, error: "Factura no encontrada" };
  const { error: e } = await s.supabase.from("collections").insert({
    ...p.data, org_id: s.org.org_id, purchase_order_id: inv.purchase_order_id, created_by: s.userId,
  });
  if (e) return { ok: false, error: friendlyDbError(e) };
  refresh(inv.purchase_order_id);
  return { ok: true };
}

export async function voidCollection(id: string, reason: string): Promise<Res> {
  const { s, error } = await billingSession();
  if (error) return { ok: false, error };
  if (!isUuid(id) || reason.trim().length < 3) return { ok: false, error: "Indicá el motivo de la anulación." };
  const { data, error: e } = await s.supabase.from("collections").update({ status: "anulado", void_reason: reason.trim() })
    .eq("id", id).eq("org_id", s.org.org_id).select("purchase_order_id").maybeSingle();
  if (e || !data) return { ok: false, error: e ? friendlyDbError(e) : "Cobro no encontrado" };
  refresh(data.purchase_order_id);
  return { ok: true };
}

/** Lee el PDF de una factura ya subida y devuelve los datos para precargar el alta. */
export async function readInvoiceDocument(documentId: string): Promise<Res<OwnInvoiceDraft>> {
  const s = await requireOrg();
  if (!isUuid(documentId)) return { ok: false, error: "Documento inválido" };
  const { data: org } = await s.supabase.from("organizations").select("cuit").eq("id", s.org.org_id).single();
  try {
    const d = await readOwnInvoice(s.supabase, documentId, org?.cuit ?? null);
    if (!d) return { ok: false, error: "No se pudo leer el PDF (¿es una foto?). Completá los datos a mano." };
    return { ok: true, data: d };
  } catch {
    return { ok: false, error: "No se pudo leer el PDF. Completá los datos a mano." };
  }
}

/**
 * Factura subida desde los documentos de la orden: si el PDF trae número, fecha y total,
 * se registra sola como factura emitida de esa orden.
 */
export async function registerInvoiceFromDocument(documentId: string, purchaseOrderId: string): Promise<Res<{ message: string; registered: boolean }>> {
  const s = await requireOrg();
  if (!canBill(s.org.role)) return { ok: true, data: { registered: false, message: "Factura adjuntada." } };
  const r = await readInvoiceDocument(documentId);
  if (!r.ok || !r.data) return { ok: true, data: { registered: false, message: "Factura adjuntada. No se pudo leer: cargala en Facturación." } };
  const d = r.data;
  if (!d.number || !d.issue_date || !d.total_amount) {
    return { ok: true, data: { registered: false, message: "Factura adjuntada. Faltan datos: completala en Facturación." } };
  }
  const res = await createInvoice({
    purchase_order_id: purchaseOrderId, invoice_type: d.invoice_type as never, point_of_sale: d.point_of_sale, number: d.number,
    issue_date: d.issue_date, due_date: "", net_amount: d.net_amount, vat_amount: d.vat_amount, other_taxes: d.other_taxes,
    total_amount: d.total_amount, cae: d.cae, document_id: documentId, notes: "",
  });
  if (!res.ok) return { ok: true, data: { registered: false, message: `Factura adjuntada, pero no se registró: ${res.error}` } };
  return { ok: true, data: { registered: true, message: `Factura ${invoiceLabel(d)} registrada por ${formatMoney(d.total_amount)}` } };
}

/** Marca una compra a proveedor como pagada (o la desmarca). */
export async function setPurchasePaid(purchaseId: string, paid: boolean, date?: string): Promise<Res> {
  const s = await requireOrg();
  if (!canBill(s.org.role) && s.org.role !== "compras") return { ok: false, error: "Tu rol no permite registrar pagos." };
  if (!isUuid(purchaseId)) return { ok: false, error: "Compra inválida" };
  const paid_date = paid ? (date && /^\d{4}-\d{2}-\d{2}$/.test(date) ? date : new Date().toISOString().slice(0, 10)) : null;
  const { error } = await s.supabase.from("purchases").update({ paid, paid_date }).eq("id", purchaseId).eq("org_id", s.org.org_id);
  if (error) return { ok: false, error: friendlyDbError(error) };
  refresh();
  revalidatePath("/compras");
  return { ok: true };
}
