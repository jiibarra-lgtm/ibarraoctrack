"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg, canWrite } from "@/lib/session";
import { purchaseOrderSchema, PO_STATUSES, type PurchaseOrderInput } from "@/lib/po/schema";
import { friendlyDbError } from "@/lib/errors";
import { isUuid } from "@/lib/utils";

export type SaveResult = { ok: true; id: string } | { ok: false; error: string; fieldErrors?: Record<string, string> };

function zodFieldErrors(err: z.ZodError) {
  const out: Record<string, string> = {};
  err.issues.forEach((i) => {
    const k = i.path.join(".");
    out[k] ??= i.message;
  });
  return out;
}

/** Alta / edición de orden. Valida en servidor y guarda atómicamente vía RPC (RLS aplica). */
export async function savePurchaseOrder(input: PurchaseOrderInput): Promise<SaveResult> {
  const s = await requireOrg();
  if (!canWrite(s.org.role)) return { ok: false, error: "Tu rol no permite modificar órdenes." };

  const parsed = purchaseOrderSchema.safeParse(input);
  if (!parsed.success) return { ok: false, error: "Revisá los campos marcados.", fieldErrors: zodFieldErrors(parsed.error) };

  const d = parsed.data;
  const payload = {
    ...d,
    id: d.id || undefined,
    items: d.items.map((it) => ({ ...it, id: it.id || undefined })),
  };

  const { data, error } = await s.supabase.rpc("save_purchase_order", { p_org: s.org.org_id, p_payload: payload });
  if (error) return { ok: false, error: friendlyDbError(error) };

  revalidatePath("/ordenes");
  revalidatePath("/dashboard");
  if (d.id) revalidatePath(`/ordenes/${d.id}`);
  return { ok: true, id: data as string };
}

export async function setPurchaseOrderStatus(id: string, status: string, reason: string, version?: number) {
  const s = await requireOrg();
  if (!isUuid(id) || !(PO_STATUSES as readonly string[]).includes(status)) return { ok: false as const, error: "Datos inválidos" };
  const { error } = await s.supabase.rpc("set_po_status", {
    p_id: id, p_status: status, p_reason: reason.trim().slice(0, 500) || null, p_version: version ?? null,
  });
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  revalidatePath(`/ordenes/${id}`);
  revalidatePath("/ordenes");
  revalidatePath("/dashboard");
  return { ok: true as const };
}

/** URL firmada de corta duración para ver/descargar un documento privado. */
export async function getDocumentUrl(documentId: string, download = false, ttl = 120) {
  const s = await requireOrg();
  if (!isUuid(documentId)) return { ok: false as const, error: "Documento inválido" };
  const { data: doc } = await s.supabase.from("documents").select("storage_path, title").eq("id", documentId).maybeSingle();
  if (!doc) return { ok: false as const, error: "Documento no encontrado" };
  const { data, error } = await s.supabase.storage
    .from("documents")
    .createSignedUrl(doc.storage_path, Math.min(Math.max(ttl, 60), 1800), download ? { download: doc.title } : undefined);
  if (error || !data) return { ok: false as const, error: "No se pudo generar el enlace" };
  return { ok: true as const, url: data.signedUrl };
}

const DOC_TYPES = ["orden_compra", "cotizacion", "factura_proveedor", "factura_emitida", "remito", "remito_oficial", "remito_provisorio", "prd",
  "constancia_recepcion", "conformidad", "comprobante_pago", "nota_credito", "contrato", "otro"] as const;

const docSchema = z.object({
  purchaseOrderId: z.string().uuid(),
  storagePath: z.string().min(10).max(500),
  title: z.string().trim().min(1).max(255),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]),
  size: z.number().int().positive().max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  docType: z.enum(DOC_TYPES).default("otro"),
  deliveryId: z.string().uuid().optional(),
});

/** Registra un documento adjunto ya subido al bucket privado (ruta {org}/...). */
export async function attachDocument(input: z.input<typeof docSchema>) {
  const s = await requireOrg();
  if (!(canWrite(s.org.role) || s.org.role === "logistica")) return { ok: false as const, error: "Tu rol no permite adjuntar documentos." };
  const parsed = docSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Archivo inválido" };
  const d = parsed.data;
  if (!d.storagePath.startsWith(`${s.org.org_id}/`)) return { ok: false as const, error: "Ruta de archivo inválida" };

  const { error } = await s.supabase.from("documents").insert({
    org_id: s.org.org_id, purchase_order_id: d.purchaseOrderId, delivery_id: d.deliveryId ?? null, doc_type: d.docType, title: d.title,
    storage_path: d.storagePath, mime_type: d.mimeType, size_bytes: d.size, sha256: d.sha256, uploaded_by: s.userId,
  });
  if (error) {
    await s.supabase.storage.from("documents").remove([d.storagePath]);
    return { ok: false as const, error: friendlyDbError(error) };
  }
  revalidatePath(`/ordenes/${d.purchaseOrderId}`);
  return { ok: true as const };
}

/** Cambia el tipo de un documento de la orden (remito oficial, PRD, factura…). */
export async function setDocumentType(documentId: string, docType: string) {
  const s = await requireOrg();
  if (!(canWrite(s.org.role) || s.org.role === "logistica")) return { ok: false as const, error: "Tu rol no permite modificar documentos." };
  const t = z.enum(DOC_TYPES).safeParse(docType);
  if (!isUuid(documentId) || !t.success) return { ok: false as const, error: "Datos inválidos" };
  const { data, error } = await s.supabase.from("documents").update({ doc_type: t.data }).eq("id", documentId).eq("org_id", s.org.org_id).select("purchase_order_id").maybeSingle();
  if (error || !data) return { ok: false as const, error: error ? friendlyDbError(error) : "Documento no encontrado" };
  if (data.purchase_order_id) revalidatePath(`/ordenes/${data.purchase_order_id}`);
  return { ok: true as const };
}
