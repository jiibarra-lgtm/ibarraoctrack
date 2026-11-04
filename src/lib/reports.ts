import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { toCsv, type Col } from "@/lib/csv";
import { orderRefs } from "@/lib/billing-load";
import { invoiceLabel } from "@/lib/billing";
import { PO_STATUS_LABEL, type PoStatus } from "@/lib/po/schema";

type R = Record<string, unknown>;
type Range = { from?: string; to?: string };
type Def = { label: string; description: string; build: (sb: SupabaseClient, org: string, r: Range) => Promise<string> };

const range = <Q extends { gte: (c: string, v: string) => Q; lte: (c: string, v: string) => Q }>(q: Q, col: string, r: Range) => {
  let x = q;
  if (r.from) x = x.gte(col, r.from);
  if (r.to) x = x.lte(col, r.to);
  return x;
};
const rel = (r: R, k: string, f: string) => ((r[k] as R | null) ?? {})[f];

async function rows(q: PromiseLike<{ data: unknown; error: { message: string } | null }>) {
  const { data, error } = await q;
  if (error) throw new Error(error.message);
  return (data ?? []) as R[];
}

export const REPORTS: Record<string, Def> = {
  ordenes: {
    label: "Órdenes de compra", description: "Una fila por orden: número, organismo, fechas, estado e importes.",
    build: async (sb, org, r) => {
      const d = await rows(range(sb.from("purchase_orders_overview").select("*").eq("org_id", org), "issue_date", r).order("issue_date", { ascending: false }).limit(10000));
      return toCsv(d, [
        { header: "OC", value: (x) => x.bac_number ?? x.display_number }, { header: "Interno", value: (x) => x.display_number },
        { header: "Organismo", value: (x) => x.customer_name }, { header: "Autorización", value: (x) => x.issue_date, type: "date" },
        { header: "Fecha límite entrega", value: (x) => x.due_date, type: "date" }, { header: "Estado", value: (x) => PO_STATUS_LABEL[x.status as PoStatus] ?? x.status },
        { header: "Expediente", value: (x) => x.expediente_number }, { header: "Procedimiento", value: (x) => x.process_number },
        { header: "Renglones", value: (x) => x.items_count, type: "number" }, { header: "Moneda", value: (x) => x.currency },
        { header: "Total", value: (x) => x.total_amount ?? x.items_total, type: "money" },
      ]);
    },
  },
  renglones: {
    label: "Renglones", description: "Cada producto adjudicado con cantidad, precio y total.",
    build: async (sb, org, r) => {
      const d = await rows(range(sb.from("purchase_order_items").select("*, purchase_orders!inner(bac_number, issue_date, currency, customers(name))").eq("org_id", org), "purchase_orders.issue_date", r).limit(20000));
      return toCsv(d, [
        { header: "OC", value: (x) => rel(x, "purchase_orders", "bac_number") }, { header: "Autorización", value: (x) => rel(x, "purchase_orders", "issue_date"), type: "date" },
        { header: "Organismo", value: (x) => ((rel(x, "purchase_orders", "customers") as R | null) ?? {}).name },
        { header: "Renglón", value: (x) => x.line_number, type: "number" }, { header: "Opción", value: (x) => x.option_number, type: "number" },
        { header: "Código", value: (x) => x.bac_code }, { header: "Descripción", value: (x) => x.description_original },
        { header: "Cantidad", value: (x) => x.quantity, type: "number" }, { header: "Unidad", value: (x) => x.unit },
        { header: "Precio unitario", value: (x) => x.unit_price, type: "money" }, { header: "Total", value: (x) => x.total_amount, type: "money" },
      ]);
    },
  },
  rentabilidad: {
    label: "Rentabilidad por orden", description: "Venta neta, costos, gastos, ganancia y margen estimado y realizado.",
    build: async (sb, org, r) => {
      const d = await rows(range(sb.from("po_profitability").select("*").eq("org_id", org), "issue_date", r).limit(10000));
      const refs = await orderRefs(sb, d.map((x) => x.purchase_order_id as string));
      return toCsv(d, [
        { header: "OC", value: (x) => refs.get(x.purchase_order_id as string)?.label }, { header: "Organismo", value: (x) => refs.get(x.purchase_order_id as string)?.customer },
        { header: "Autorización", value: (x) => x.issue_date, type: "date" }, { header: "Venta neta", value: (x) => x.sales_net, type: "money" },
        { header: "Costo comprado", value: (x) => x.direct_cost_real, type: "money" }, { header: "Costo estimado total", value: (x) => x.direct_cost_estimated, type: "money" },
        { header: "Gastos", value: (x) => x.other_costs, type: "money" }, { header: "Ganancia estimada", value: (x) => x.operating_profit_estimated, type: "money" },
        { header: "Margen estimado %", value: (x) => x.operating_margin_estimated, type: "number" }, { header: "Markup %", value: (x) => x.markup_estimated, type: "number" },
        { header: "Entregado %", value: (x) => x.delivered_pct, type: "number" }, { header: "Ganancia realizada", value: (x) => x.operating_profit_realized, type: "money" },
      ]);
    },
  },
  compras: {
    label: "Compras a proveedores", description: "Facturas de proveedores, importes y estado de pago.",
    build: async (sb, org, r) => {
      const d = await rows(range(sb.from("purchases").select("*, suppliers(name, cuit)").eq("org_id", org), "invoice_date", r).order("invoice_date", { ascending: false }).limit(10000));
      return toCsv(d, [
        { header: "Fecha", value: (x) => x.invoice_date, type: "date" }, { header: "Proveedor", value: (x) => rel(x, "suppliers", "name") },
        { header: "CUIT", value: (x) => rel(x, "suppliers", "cuit") }, { header: "Comprobante", value: (x) => `${x.point_of_sale ?? ""}-${x.number ?? ""}` },
        { header: "Neto", value: (x) => x.net_amount, type: "money" }, { header: "IVA", value: (x) => x.vat_amount, type: "money" },
        { header: "Otros impuestos", value: (x) => x.other_taxes, type: "money" }, { header: "Total", value: (x) => x.total_amount, type: "money" },
        { header: "Vence", value: (x) => x.due_date, type: "date" }, { header: "Pagada", value: (x) => (x.paid ? "Sí" : "No") },
        { header: "Fecha pago", value: (x) => x.paid_date, type: "date" }, { header: "Estado", value: (x) => x.status },
      ]);
    },
  },
  gastos: {
    label: "Gastos", description: "Flete, embalaje, comisiones y otros, con su categoría.",
    build: async (sb, org, r) => {
      const d = await rows(range(sb.from("costs").select("*, cost_categories(name, kind)").eq("org_id", org), "cost_date", r).order("cost_date", { ascending: false }).limit(10000));
      return toCsv(d, [
        { header: "Fecha", value: (x) => x.cost_date, type: "date" }, { header: "Categoría", value: (x) => rel(x, "cost_categories", "name") },
        { header: "Descripción", value: (x) => x.description }, { header: "Neto", value: (x) => x.net_amount, type: "money" },
        { header: "Total", value: (x) => x.total_amount, type: "money" }, { header: "Reparto", value: (x) => x.allocation_method }, { header: "Estado", value: (x) => x.status },
      ]);
    },
  },
  entregas: {
    label: "Entregas", description: "Entregas por orden con fecha, estado y remito.",
    build: async (sb, org, r) => {
      const d = await rows(range(sb.from("deliveries").select("*").eq("org_id", org), "planned_date", r).order("planned_date", { ascending: false }).limit(10000));
      const refs = await orderRefs(sb, d.map((x) => x.purchase_order_id as string));
      return toCsv(d, [
        { header: "OC", value: (x) => refs.get(x.purchase_order_id as string)?.label }, { header: "Organismo", value: (x) => refs.get(x.purchase_order_id as string)?.customer },
        { header: "Programada", value: (x) => x.planned_date, type: "date" }, { header: "Entregada", value: (x) => x.actual_date, type: "date" },
        { header: "Estado", value: (x) => x.status }, { header: "Remito", value: (x) => x.remito_number }, { header: "Lugar", value: (x) => x.delivery_place }, { header: "Responsable", value: (x) => x.responsible },
      ]);
    },
  },
  facturas: {
    label: "Facturas emitidas", description: "Facturas a organismos con cobrado, retenciones y saldo.",
    build: async (sb, org, r) => {
      const d = await rows(range(sb.from("invoice_balances").select("*").eq("org_id", org), "issue_date", r).order("issue_date", { ascending: false }).limit(10000));
      const refs = await orderRefs(sb, d.map((x) => x.purchase_order_id as string));
      return toCsv(d, [
        { header: "Factura", value: (x) => invoiceLabel(x as never) }, { header: "Fecha", value: (x) => x.issue_date, type: "date" },
        { header: "Vence", value: (x) => x.due_date, type: "date" }, { header: "OC", value: (x) => refs.get(x.purchase_order_id as string)?.label },
        { header: "Organismo", value: (x) => refs.get(x.purchase_order_id as string)?.customer }, { header: "Total", value: (x) => x.total_amount, type: "money" },
        { header: "Cobrado (banco)", value: (x) => x.cash_received, type: "money" }, { header: "Retenciones", value: (x) => x.withholdings, type: "money" },
        { header: "Saldo", value: (x) => x.balance, type: "money" }, { header: "Estado", value: (x) => x.collection_status },
        { header: "Días de atraso", value: (x) => (Number(x.days_overdue) > 0 ? x.days_overdue : ""), type: "number" },
      ]);
    },
  },
  cobros: {
    label: "Cobros y retenciones", description: "Cada cobro con el detalle de retenciones (IIBB, Ganancias, IVA, SUSS).",
    build: async (sb, org, r) => {
      const d = await rows(range(sb.from("collections").select("*, sales_invoices(invoice_type, point_of_sale, number)").eq("org_id", org).eq("status", "confirmado"), "payment_date", r).order("payment_date", { ascending: false }).limit(10000));
      const refs = await orderRefs(sb, d.map((x) => x.purchase_order_id as string));
      return toCsv(d, [
        { header: "Fecha", value: (x) => x.payment_date, type: "date" }, { header: "Organismo", value: (x) => refs.get(x.purchase_order_id as string)?.customer },
        { header: "OC", value: (x) => refs.get(x.purchase_order_id as string)?.label }, { header: "Factura", value: (x) => invoiceLabel(x.sales_invoices as never) },
        { header: "Recibido", value: (x) => x.amount_received, type: "money" }, { header: "Ret. IIBB", value: (x) => x.ret_iibb, type: "money" },
        { header: "Ret. Ganancias", value: (x) => x.ret_ganancias, type: "money" }, { header: "Ret. IVA", value: (x) => x.ret_iva, type: "money" },
        { header: "Ret. SUSS", value: (x) => x.ret_suss, type: "money" }, { header: "Otras", value: (x) => x.ret_otras, type: "money" },
        { header: "Cancela", value: (x) => x.applied_amount, type: "money" }, { header: "Medio", value: (x) => x.method }, { header: "Referencia", value: (x) => x.reference },
      ]);
    },
  },
};

export type ReportKey = keyof typeof REPORTS;
export type { Col };
