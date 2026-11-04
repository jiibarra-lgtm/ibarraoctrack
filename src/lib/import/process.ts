import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";
import { parseBacText } from "@/lib/bac/parse-text";
import { aiAvailable, extractWithAi } from "@/lib/bac/ai";
import { mergeExtractions } from "@/lib/bac/merge";
import { validateOrderMath } from "@/lib/bac/validate";
import type { ExtractedOrder } from "@/lib/bac/types";
import { emptyPurchaseOrder } from "@/lib/po/schema";

export type ProcessOutcome = { status: string; error?: string };

/**
 * Procesa un trabajo de importación. Idempotente y seguro ante concurrencia:
 * sólo avanza si logra "tomar" el trabajo (claim_import_job con lock y vencimiento).
 * Se ejecuta en una invocación separada de la subida, con reintentos limitados.
 */
export async function processImportJob(supabase: SupabaseClient, jobId: string): Promise<ProcessOutcome> {
  const { data: job, error: claimErr } = await supabase.rpc("claim_import_job", { p_job: jobId });
  if (claimErr) return { status: "error", error: claimErr.message };
  if (!job?.id) {
    const { data: current } = await supabase.from("import_jobs").select("status").eq("id", jobId).single();
    return { status: current?.status ?? "desconocido" };
  }

  try {
    const { data: doc, error: docErr } = await supabase
      .from("documents").select("id, org_id, storage_path, mime_type, sha256, title").eq("id", job.document_id).single();
    if (docErr || !doc) throw new Error("Documento no encontrado");

    const { data: blob, error: dlErr } = await supabase.storage.from("documents").download(doc.storage_path);
    if (dlErr || !blob) throw new Error(`No se pudo leer el archivo: ${dlErr?.message ?? "vacío"}`);
    const buffer = Buffer.from(await blob.arrayBuffer());

    // Integridad: el archivo almacenado debe coincidir con el hash registrado
    const sha = createHash("sha256").update(buffer).digest("hex");
    if (sha !== doc.sha256) throw new Error("El archivo almacenado no coincide con el hash registrado (integridad).");

    let textResult: ExtractedOrder | null = null;
    let aiResult: ExtractedOrder | null = null;
    let rawText: string | null = null;
    let method: "texto" | "ocr" = "texto";
    const notes: ExtractedOrder["warnings"] = [];

    if (doc.mime_type === "application/pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      rawText = text;
      if (text.replace(/\s/g, "").length > 200) {
        textResult = parseBacText(text);
      } else {
        method = "ocr";
        notes.push({ level: "info", message: "El PDF no tiene texto seleccionable (parece escaneado)." });
      }
    } else {
      method = "ocr";
    }

    const needsAi = !textResult || textResult.review.length > 0 || method === "ocr";
    if (needsAi && aiAvailable()) {
      try {
        aiResult = (await extractWithAi({ buffer, mimeType: doc.mime_type })).result;
      } catch (e) {
        if (!textResult) throw e;
        notes.push({ level: "warning", message: `La lectura con IA falló (${(e as Error).message}); se usó sólo el texto.` });
      }
    } else if (needsAi && !textResult) {
      notes.push({
        level: "warning",
        message: "La lectura automática de imágenes requiere configurar ANTHROPIC_API_KEY. Completá los datos mirando el documento.",
      });
    }

    const extracted: ExtractedOrder =
      textResult || aiResult
        ? mergeExtractions(textResult, aiResult)
        : { order: emptyPurchaseOrder(), review: ["bac_number", "customer_name", "items"], warnings: [] };

    const math = validateOrderMath(extracted.order);
    const warnings = [...notes, ...extracted.warnings, ...math.warnings];
    const review = [...new Set([...extracted.review, ...math.review])];

    // Duplicado por número de OC
    if (extracted.order.bac_number) {
      const { data: dup } = await supabase
        .from("purchase_orders").select("id").eq("org_id", doc.org_id).ilike("bac_number", extracted.order.bac_number).maybeSingle();
      if (dup) {
        warnings.unshift({ level: "error", path: "bac_number", message: `La orden ${extracted.order.bac_number} ya está cargada.`, });
        review.push("bac_number");
      }
    }

    const extractor = textResult && aiResult ? "combinado" : aiResult ? "ia" : "heuristica";
    const { error: insErr } = await supabase.from("extracted_document_data").insert({
      org_id: doc.org_id, import_job_id: job.id, extractor, method,
      raw_text: rawText?.slice(0, 200_000) ?? null,
      data: { order: extracted.order, review },
      warnings,
    });
    if (insErr) throw new Error(insErr.message);

    await supabase.from("import_jobs").update({ status: "revision", finished_at: new Date().toISOString(), locked_at: null }).eq("id", job.id);
    return { status: "revision" };
  } catch (e) {
    const message = (e as Error).message?.slice(0, 1000) || "Error desconocido";
    await supabase.from("import_jobs").update({ status: "error", last_error: message, locked_at: null }).eq("id", job.id);
    return { status: "error", error: message };
  }
}
