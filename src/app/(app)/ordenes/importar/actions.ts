"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg, canWrite } from "@/lib/session";
import { purchaseOrderSchema, type PurchaseOrderInput } from "@/lib/po/schema";
import { friendlyDbError } from "@/lib/errors";
import { isUuid } from "@/lib/utils";
import type { SaveResult } from "../actions";

/** Detección de duplicados por hash antes de subir. */
export async function checkDuplicate(sha256: string) {
  const s = await requireOrg();
  if (!/^[0-9a-f]{64}$/.test(sha256)) return null;
  const { data: doc } = await s.supabase
    .from("documents").select("id, title, purchase_order_id, created_at").eq("org_id", s.org.org_id).eq("sha256", sha256).maybeSingle();
  if (!doc) return null;
  const { data: job } = await s.supabase
    .from("import_jobs").select("id, status").eq("document_id", doc.id).order("created_at", { ascending: false }).limit(1).maybeSingle();
  return { documentId: doc.id, title: doc.title, purchaseOrderId: doc.purchase_order_id as string | null, jobId: job?.id ?? null, jobStatus: job?.status ?? null };
}

const registerSchema = z.object({
  storagePath: z.string().min(10).max(500),
  title: z.string().trim().min(1).max(255),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]),
  size: z.number().int().positive().max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/** Registra el documento subido y crea el trabajo de importación (procesamiento desacoplado). */
export async function registerImport(input: z.input<typeof registerSchema>) {
  const s = await requireOrg();
  if (!canWrite(s.org.role)) return { ok: false as const, error: "Tu rol no permite importar órdenes." };
  const parsed = registerSchema.safeParse(input);
  if (!parsed.success) return { ok: false as const, error: "Archivo inválido" };
  const d = parsed.data;
  if (!d.storagePath.startsWith(`${s.org.org_id}/`)) return { ok: false as const, error: "Ruta inválida" };

  const { data: doc, error: docErr } = await s.supabase.from("documents").insert({
    org_id: s.org.org_id, doc_type: "orden_compra", title: d.title, storage_path: d.storagePath,
    mime_type: d.mimeType, size_bytes: d.size, sha256: d.sha256, uploaded_by: s.userId,
  }).select("id").single();
  if (docErr || !doc) {
    await s.supabase.storage.from("documents").remove([d.storagePath]);
    return { ok: false as const, error: friendlyDbError(docErr) };
  }
  const { data: job, error: jobErr } = await s.supabase.from("import_jobs").insert({
    org_id: s.org.org_id, kind: "orden_bac", document_id: doc.id, created_by: s.userId,
  }).select("id").single();
  if (jobErr || !job) return { ok: false as const, error: friendlyDbError(jobErr) };

  revalidatePath("/ordenes/importar");
  return { ok: true as const, jobId: job.id as string };
}

/** Confirma la revisión: crea la orden, vincula el documento y cierra el trabajo (una transacción). */
export async function confirmImport(jobId: string, input: PurchaseOrderInput): Promise<SaveResult> {
  const s = await requireOrg();
  if (!canWrite(s.org.role)) return { ok: false, error: "Tu rol no permite importar órdenes." };
  if (!isUuid(jobId)) return { ok: false, error: "Importación inválida" };
  const parsed = purchaseOrderSchema.safeParse(input);
  if (!parsed.success) {
    const fieldErrors: Record<string, string> = {};
    parsed.error.issues.forEach((i) => (fieldErrors[i.path.join(".")] ??= i.message));
    return { ok: false, error: "Revisá los campos marcados.", fieldErrors };
  }
  const d = parsed.data;
  const payload = { ...d, id: undefined, version: undefined, items: d.items.map((it) => ({ ...it, id: undefined })) };
  const { data, error } = await s.supabase.rpc("confirm_po_import", { p_job: jobId, p_payload: payload });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/ordenes");
  revalidatePath("/ordenes/importar");
  revalidatePath("/dashboard");
  return { ok: true, id: data as string };
}

export async function discardImport(jobId: string) {
  const s = await requireOrg();
  if (!isUuid(jobId)) return { ok: false as const, error: "Importación inválida" };
  const { error } = await s.supabase.from("import_jobs")
    .update({ status: "descartado", finished_at: new Date().toISOString() })
    .eq("id", jobId).in("status", ["pendiente", "revision", "error"]);
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  revalidatePath("/ordenes/importar");
  return { ok: true as const };
}

/** Reabre un trabajo para reprocesar (por ejemplo, después de configurar la IA). */
export async function retryImport(jobId: string) {
  const s = await requireOrg();
  if (!isUuid(jobId)) return { ok: false as const, error: "Importación inválida" };
  const { error } = await s.supabase.from("import_jobs")
    .update({ status: "pendiente", attempts: 0, last_error: null, locked_at: null })
    .eq("id", jobId).in("status", ["error", "revision"]);
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  return { ok: true as const };
}
