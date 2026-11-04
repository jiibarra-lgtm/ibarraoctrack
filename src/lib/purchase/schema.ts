import { z } from "zod";
import { isValidDecimal, parseArNumber } from "@/lib/money";

const num = (label: string, required = false) =>
  z.string().trim()
    .transform((v) => (v === "" ? "" : (parseArNumber(v) ?? v)))
    .refine((v) => (required ? v !== "" : true), `${label} es obligatorio`)
    .refine((v) => v === "" || isValidDecimal(v), `${label}: número inválido`)
    .refine((v) => v === "" || Number(v) >= 0, `${label} no puede ser negativo`);

export const DOC_TYPES = [
  ["factura_a", "Factura A"], ["factura_b", "Factura B"], ["factura_c", "Factura C"], ["factura_m", "Factura M"],
  ["ticket", "Ticket"], ["remito", "Remito"], ["otro", "Otro"],
] as const;

export const allocationSchema = z.object({
  purchase_order_item_id: z.string().uuid(),
  label: z.string().optional().default(""),
  quantity: num("Cantidad asignada", true).refine((v) => Number(v) > 0, "Cantidad asignada > 0"),
});

export const purchaseItemSchema = z.object({
  description: z.string().trim().min(1, "Descripción obligatoria").max(2000),
  quantity: num("Cantidad", true).refine((v) => Number(v) > 0, "Cantidad > 0"),
  unit: z.string().trim().max(40).optional().default(""),
  unit_price: num("Precio", true),
  discount_pct: num("Bonificación").refine((v) => v === "" || Number(v) <= 100, "Máximo 100%"),
  vat_rate: num("IVA"),
  net_amount: num("Neto"),
  allocations: z.array(allocationSchema).default([]),
});

export const purchaseSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  supplier_id: z.string().uuid().optional().or(z.literal("")),
  supplier_name: z.string().trim().max(200).optional().default(""),
  supplier_cuit: z.string().trim().regex(/^(\d{2}-?\d{8}-?\d)?$/, "CUIT inválido").optional().default(""),
  doc_type: z.enum(DOC_TYPES.map((d) => d[0]) as [string, ...string[]]).default("factura_a"),
  point_of_sale: z.string().trim().max(10).optional().default(""),
  number: z.string().trim().max(20).optional().default(""),
  invoice_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha obligatoria"),
  due_date: z.string().optional().default(""),
  net_amount: num("Neto"),
  vat_amount: num("IVA"),
  other_taxes: num("Otros impuestos"),
  total_amount: num("Total", true),
  payment_terms: z.string().trim().max(200).optional().default(""),
  paid: z.boolean().default(false),
  cae: z.string().trim().max(20).optional().default(""),
  notes: z.string().trim().max(2000).optional().default(""),
  document_id: z.string().uuid().optional().or(z.literal("")),
  import_job_id: z.string().uuid().optional().or(z.literal("")),
  items: z.array(purchaseItemSchema).min(1, "Cargá al menos un renglón"),
}).superRefine((p, ctx) => {
  if (!p.supplier_id && !p.supplier_name) ctx.addIssue({ code: "custom", path: ["supplier_name"], message: "Indicá el proveedor" });
  p.items.forEach((it, i) => {
    const allocated = it.allocations.reduce((a, x) => a + Number(x.quantity || 0), 0);
    if (allocated > Number(it.quantity) + 1e-9) {
      ctx.addIssue({ code: "custom", path: ["items", i, "allocations"], message: `Asignaste ${allocated} y la compra tiene ${it.quantity}` });
    }
  });
});

export type PurchaseInput = z.input<typeof purchaseSchema>;
export type PurchaseItemInput = z.input<typeof purchaseItemSchema>;

export function emptyPurchaseItem(): PurchaseItemInput {
  return { description: "", quantity: "", unit: "", unit_price: "", discount_pct: "0", vat_rate: "21", net_amount: "", allocations: [] };
}
