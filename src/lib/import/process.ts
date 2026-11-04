import "server-only";
import { createHash } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";
import { parseBacText, validCuit } from "@/lib/bac/parse-text";
import { aiAvailable, extractWithAi } from "@/lib/bac/ai";
import { ocrImage } from "@/lib/bac/ocr";
import { mergeExtractions } from "@/lib/bac/merge";
import { validateOrderMath } from "@/lib/bac/validate";
import type { ExtractedOrder, ExtractionWarning } from "@/lib/bac/types";
import { emptyPurchaseOrder, purchaseOrderSchema } from "@/lib/po/schema";
import { processInvoiceJob, processRemitoJob } from "./process-docs";

export type ProcessOutcome = { status: string; error?: string; purchaseOrderId?: string };

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "");
function digitDiff(a: string, b: string) {
  if (a.length !== b.length) return Infinity;
  let d = 0;
  for (let i = 0; i < a.length; i++) if (a[i] !== b[i]) d++;
  return d;
}

/**
 * El adjudicatario de una OC propia es la empresa: si el CUIT leído es inválido o difiere en
 * 1–2 dígitos del CUIT de la empresa (error típico de OCR), se usa el de la empresa.
 */
function reconcileAwardee(ex: ExtractedOrder, org: { legal_name: string | null; cuit: string | null }, warnings: ExtractionWarning[]) {
  const orgCuit = digits(org.cuit);
  if (orgCuit.length !== 11) return;
  const read = digits(ex.order.awardee_cuit);
  const fmt = `${orgCuit.slice(0, 2)}-${orgCuit.slice(2, 10)}-${orgCuit.slice(10)}`;
  if (!read || !validCuit(read) || digitDiff(read, orgCuit) <= 2) {
    ex.order.awardee_cuit = fmt;
    if (!ex.order.awardee_name && org.legal_name) ex.order.awardee_name = org.legal_name;
    ex.review = ex.review.filter((r) => r !== "awardee_cuit");
  } else if (read !== orgCuit) {
    warnings.push({ level: "error", path: "awardee_cuit", message: `La orden está adjudicada al CUIT ${ex.order.awardee_cuit}, que no es el de tu empresa.` });
    ex.review.push("awardee_cuit");
  }
}

/**
 * Procesa un trabajo de importación. Idempotente y seguro ante concurrencia:
 * sólo avanza si logra "tomar" el trabajo (claim_import_job con lock y vencimiento).
 * Si la lectura queda completa y todas las cuentas cierran, la orden se crea sola.
 */
export async function processImportJob(supabase: SupabaseClient, jobId: string, opts: { autoConfirm?: boolean } = {}): Promise<ProcessOutcome> {
  const { data: job, error: claimErr } = await supabase.rpc("claim_import_job", { p_job: jobId });
  if (claimErr) return { status: "error", error: claimErr.message };
  if (!job?.id) {
    const { data: current } = await supabase.from("import_jobs").select("status, result_purchase_order_id").eq("id", jobId).single();
    return { status: current?.status ?? "desconocido", purchaseOrderId: current?.result_purchase_order_id ?? undefined };
  }

  try {
    const { data: doc, error: docErr } = await supabase
      .from("documents").select("id, org_id, storage_path, mime_type, sha256, title").eq("id", job.document_id).single();
    if (docErr || !doc) throw new Error("Documento no encontrado");
    const { data: org } = await supabase.from("organizations").select("legal_name, cuit").eq("id", doc.org_id).single();

    const { data: blob, error: dlErr } = await supabase.storage.from("documents").download(doc.storage_path);
    if (dlErr || !blob) throw new Error(`No se pudo leer el archivo: ${dlErr?.message ?? "vacío"}`);
    const buffer = Buffer.from(await blob.arrayBuffer());

    // Integridad: el archivo almacenado debe coincidir con el hash registrado
    const sha = createHash("sha256").update(buffer).digest("hex");
    if (sha !== doc.sha256) throw new Error("El archivo almacenado no coincide con el hash registrado (integridad).");

    // Facturas de proveedor y remitos: lectura + sugerencias, siempre con confirmación humana
    if (job.kind === "factura_proveedor") return await processInvoiceJob(supabase, job.id, doc, org, buffer);
    if (job.kind === "remito") return await processRemitoJob(supabase, job.id, doc, buffer);

    let textResult: ExtractedOrder | null = null;
    let aiResult: ExtractedOrder | null = null;
    let rawText: string | null = null;
    let method: "texto" | "ocr" = "texto";
    const notes: ExtractionWarning[] = [];

    if (doc.mime_type === "application/pdf") {
      const pdf = await getDocumentProxy(new Uint8Array(buffer));
      const { text } = await extractText(pdf, { mergePages: true });
      rawText = text;
      if (text.replace(/\s/g, "").length > 200) textResult = parseBacText(text);
      else {
        method = "ocr";
        notes.push({ level: "info", message: "El PDF no tiene texto seleccionable (parece escaneado)." });
      }
    } else {
      method = "ocr";
      const { text } = await ocrImage(buffer);
      rawText = text;
      textResult = parseBacText(text);
    }

    // IA opcional: doble verificación si hay dudas, o lectura principal de PDFs escaneados
    const needsAi = !textResult || textResult.review.length > 0;
    if (needsAi && aiAvailable()) {
      try {
        aiResult = (await extractWithAi({ buffer, mimeType: doc.mime_type })).result;
      } catch (e) {
        if (!textResult) throw e;
        notes.push({ level: "warning", message: `La lectura con IA falló (${(e as Error).message}); se usó la lectura propia.` });
      }
    }

    const extracted: ExtractedOrder =
      textResult || aiResult
        ? mergeExtractions(textResult, aiResult)
        : { order: emptyPurchaseOrder(), review: ["bac_number", "customer_name", "items"], warnings: [] };

    const warnings: ExtractionWarning[] = [...notes, ...extracted.warnings];
    if (org) reconcileAwardee(extracted, org, warnings);
    const math = validateOrderMath(extracted.order);
    warnings.push(...math.warnings);
    const review = [...new Set([...extracted.review, ...math.review])];

    // Duplicado por número de OC
    let duplicate = false;
    if (extracted.order.bac_number) {
      const { data: dup } = await supabase
        .from("purchase_orders").select("id").eq("org_id", doc.org_id).ilike("bac_number", extracted.order.bac_number).maybeSingle();
      if (dup) {
        duplicate = true;
        warnings.unshift({ level: "error", path: "bac_number", message: `La orden ${extracted.order.bac_number} ya está cargada.` });
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

    // ---- Guardado automático: sólo si no queda nada dudoso y las cuentas cierran
    const items = extracted.order.items ?? [];
    const clean =
      !duplicate &&
      review.length === 0 &&
      !warnings.some((w) => w.level === "error" || w.level === "warning") &&
      items.length > 0 &&
      Boolean(extracted.order.total_amount) &&
      items.every((it) => it.quantity && it.unit_price && it.total_amount && it.description_original);

    if (clean && opts.autoConfirm !== false) {
      const parsed = purchaseOrderSchema.safeParse(extracted.order);
      if (parsed.success) {
        const d = parsed.data;
        const payload = { ...d, id: undefined, version: undefined, items: d.items.map((it) => ({ ...it, id: undefined })) };
        const { data: poId, error: confErr } = await supabase.rpc("confirm_po_import", { p_job: job.id, p_payload: payload });
        if (!confErr && poId) return { status: "confirmado", purchaseOrderId: poId as string };
      }
    }
    return { status: "revision" };
  } catch (e) {
    const message = (e as Error).message?.slice(0, 1000) || "Error desconocido";
    await supabase.from("import_jobs").update({ status: "error", last_error: message, locked_at: null }).eq("id", job.id);
    return { status: "error", error: message };
  }
}
