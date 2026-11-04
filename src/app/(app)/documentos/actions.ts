"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg, canWrite } from "@/lib/session";
import { friendlyDbError } from "@/lib/errors";

const schema = z.object({
  documentId: z.string().uuid(),
  storagePath: z.string().min(10).max(500),
  mimeType: z.enum(["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"]),
  size: z.number().int().positive().max(25 * 1024 * 1024),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
});

/** Nueva versión: la anterior queda en document_versions (nada se pisa). */
export async function uploadNewVersion(input: z.input<typeof schema>) {
  const s = await requireOrg();
  if (!(canWrite(s.org.role) || s.org.role === "logistica")) return { ok: false as const, error: "No permitido" };
  const p = schema.safeParse(input);
  if (!p.success || !p.data.storagePath.startsWith(`${s.org.org_id}/`)) return { ok: false as const, error: "Archivo inválido" };
  const { data: doc } = await s.supabase.from("documents").select("*").eq("id", p.data.documentId).eq("org_id", s.org.org_id).maybeSingle();
  if (!doc) return { ok: false as const, error: "Documento inexistente" };
  const { error: vErr } = await s.supabase.from("document_versions").insert({
    org_id: s.org.org_id, document_id: doc.id, version: doc.current_version, storage_path: doc.storage_path,
    size_bytes: doc.size_bytes, sha256: doc.sha256, uploaded_by: doc.uploaded_by,
  });
  if (vErr) return { ok: false as const, error: friendlyDbError(vErr) };
  const { error } = await s.supabase.from("documents").update({
    storage_path: p.data.storagePath, mime_type: p.data.mimeType, size_bytes: p.data.size, sha256: p.data.sha256,
    current_version: doc.current_version + 1, uploaded_by: s.userId,
  }).eq("id", doc.id);
  if (error) return { ok: false as const, error: friendlyDbError(error) };
  revalidatePath("/documentos");
  return { ok: true as const };
}
