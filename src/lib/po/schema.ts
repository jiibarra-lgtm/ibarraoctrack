import { z } from "zod";
import { isValidDecimal, parseArNumber } from "@/lib/money";

/** Estados internos de la orden (enum po_status en Postgres). */
export const PO_STATUSES = [
  "borrador", "recibida", "perfeccionada", "en_ejecucion", "completada", "cerrada", "anulada",
] as const;
export type PoStatus = (typeof PO_STATUSES)[number];

export const PO_STATUS_LABEL: Record<PoStatus, string> = {
  borrador: "Borrador",
  recibida: "Recibida",
  perfeccionada: "Perfeccionada",
  en_ejecucion: "En ejecución",
  completada: "Completada",
  cerrada: "Cerrada",
  anulada: "Anulada",
};

const optText = z.string().trim().max(5000).optional().or(z.literal("")).transform((v) => v ?? "");
const optDate = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, "Fecha inválida")
  .optional()
  .or(z.literal(""))
  .transform((v) => v ?? "");

const money = (label: string, { required = false } = {}) =>
  z
    .string()
    .trim()
    .transform((v) => (v === "" ? "" : (parseArNumber(v) ?? v)))
    .refine((v) => (required ? v !== "" : true), `${label} es obligatorio`)
    .refine((v) => v === "" || isValidDecimal(v), `${label}: número inválido`)
    .refine((v) => v === "" || Number(v) >= 0, `${label} no puede ser negativo`);

export const poItemSchema = z.object({
  id: z.string().uuid().optional().or(z.literal("")),
  line_number: z.coerce.number().int("Renglón debe ser entero").positive("Renglón inválido"),
  option_number: z.coerce.number().int().positive().default(1),
  bac_code: optText,
  internal_code: optText,
  description_original: z.string().trim().min(1, "Descripción obligatoria").max(10000),
  description_normalized: optText,
  quantity: money("Cantidad", { required: true }).refine((v) => Number(v) > 0, "Cantidad debe ser mayor a 0"),
  unit: optText,
  unit_price: money("Precio unitario", { required: true }),
  total_amount: money("Total", { required: true }),
  packaging: optText,
  delivery_address: optText,
  delivery_phone: optText,
  delivery_term: optText,
  delivery_notes: optText,
  notes: optText,
});

export const authorizerSchema = z.object({
  nombre: z.string().trim().max(200),
  cargo: z.string().trim().max(200).optional().default(""),
  fecha: optDate,
});

export const purchaseOrderSchema = z
  .object({
    id: z.string().uuid().optional().or(z.literal("")),
    version: z.coerce.number().int().optional(),
    bac_number: optText,
    bac_type: optText,
    fiscal_year: z.string().trim().regex(/^(\d{4})?$/, "Ejercicio inválido").optional().default(""),
    bac_status: optText,
    contract_duration: optText,
    expediente_number: optText,
    process_number: optText,
    contratacion_number: optText,
    process_type: optText,
    modality: optText,
    process_class: optText,
    legal_framework: optText,
    award_act_number: optText,
    customer_id: z.string().uuid().optional().or(z.literal("")),
    customer_name: optText,
    jurisdiction: optText,
    dependencia: optText,
    buyer_phone: optText,
    buyer_address: optText,
    buyer_notes: optText,
    awardee_name: optText,
    awardee_cuit: z.string().trim().regex(/^(\d{2}-?\d{8}-?\d)?$/, "CUIT inválido").optional().default(""),
    awardee_entity_number: optText,
    issue_date: optDate,
    received_date: optDate,
    perfected_date: optDate,
    delivery_term_text: optText,
    delivery_term_days: z.string().trim().regex(/^\d*$/, "Días inválidos").optional().default(""),
    due_date: optDate,
    delivery_place: optText,
    payment_terms: optText,
    contract_terms: optText,
    currency: z.string().trim().regex(/^[A-Z]{3}$/, "Moneda inválida").default("ARS"),
    discount_amount: money("Importe bonificado"),
    net_amount: money("Importe neto"),
    vat_amount: money("IVA"),
    total_amount: money("Importe total"),
    notes: optText,
    status: z.enum(PO_STATUSES).default("recibida"),
    authorizers: z.array(authorizerSchema).default([]),
    items: z.array(poItemSchema).min(1, "La orden debe tener al menos un renglón"),
  })
  .superRefine((po, ctx) => {
    if (!po.customer_id && !po.customer_name) {
      ctx.addIssue({ code: "custom", path: ["customer_name"], message: "Indicá el organismo comprador" });
    }
    const seen = new Set<string>();
    po.items.forEach((it, i) => {
      const key = `${it.line_number}-${it.option_number}`;
      if (seen.has(key)) {
        ctx.addIssue({ code: "custom", path: ["items", i, "line_number"], message: "Renglón/opción repetido" });
      }
      seen.add(key);
    });
  });

export type PurchaseOrderInput = z.input<typeof purchaseOrderSchema>;
export type PurchaseOrderData = z.output<typeof purchaseOrderSchema>;
export type PoItemData = z.output<typeof poItemSchema>;

export function emptyItem(line = 1): z.input<typeof poItemSchema> {
  return {
    line_number: line, option_number: 1, bac_code: "", internal_code: "", description_original: "",
    description_normalized: "", quantity: "", unit: "UNIDAD", unit_price: "", total_amount: "",
    packaging: "", delivery_address: "", delivery_phone: "", delivery_term: "", delivery_notes: "", notes: "",
  };
}

export function emptyPurchaseOrder(): PurchaseOrderInput {
  return {
    bac_number: "", bac_type: "", fiscal_year: "", bac_status: "", contract_duration: "",
    expediente_number: "", process_number: "", contratacion_number: "", process_type: "", modality: "",
    process_class: "", legal_framework: "", award_act_number: "", customer_id: "", customer_name: "",
    jurisdiction: "", dependencia: "", buyer_phone: "", buyer_address: "", buyer_notes: "",
    awardee_name: "", awardee_cuit: "", awardee_entity_number: "", issue_date: "", received_date: "",
    perfected_date: "", delivery_term_text: "", delivery_term_days: "", due_date: "", delivery_place: "",
    payment_terms: "", contract_terms: "", currency: "ARS", discount_amount: "", net_amount: "",
    vat_amount: "", total_amount: "", notes: "", status: "recibida", authorizers: [], items: [emptyItem(1)],
  };
}

/** Mapea el estado informado por BAC al estado interno. */
export function statusFromBac(bacStatus: string | null | undefined): PoStatus {
  const s = (bacStatus ?? "").toLowerCase();
  if (s.includes("perfeccion")) return "perfeccionada";
  if (s.includes("anulad") || s.includes("rescind")) return "anulada";
  return "recibida";
}
