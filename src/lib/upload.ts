"use client";
import { createClient } from "@/lib/supabase/client";

export const ACCEPTED_TYPES = ["application/pdf", "image/jpeg", "image/png", "image/webp", "image/heic"] as const;
export const MAX_BYTES = 25 * 1024 * 1024;

export async function sha256Hex(file: Blob): Promise<string> {
  const buf = await file.arrayBuffer();
  const hash = await crypto.subtle.digest("SHA-256", buf);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function safeName(name: string) {
  return name.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/[^\w.-]+/g, "_").slice(-100) || "archivo";
}

export function validateFile(file: File): string | null {
  if (!(ACCEPTED_TYPES as readonly string[]).includes(file.type)) return "Formato no admitido. Usá PDF, JPG, PNG o WEBP.";
  if (file.size === 0) return "El archivo está vacío.";
  if (file.size > MAX_BYTES) return "El archivo supera los 25 MB.";
  return null;
}

/** Sube al bucket privado en {org}/{carpeta}/{uuid}-{nombre}. RLS de Storage valida la organización. */
export async function uploadPrivate(file: File, orgId: string, folder: string) {
  const err = validateFile(file);
  if (err) throw new Error(err);
  const sha256 = await sha256Hex(file);
  const path = `${orgId}/${folder}/${crypto.randomUUID()}-${safeName(file.name)}`;
  const supabase = createClient();
  const { error } = await supabase.storage.from("documents").upload(path, file, { contentType: file.type, upsert: false });
  if (error) throw new Error(error.message);
  return { path, sha256, size: file.size, mimeType: file.type, title: file.name };
}
