import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";
import { ocrImage } from "@/lib/bac/ocr";
import { parseInvoiceText } from "@/lib/invoice/parse";
import { matchRemitoLines, readRemitoHeader } from "@/lib/remito/parse";
import type { ProcessOutcome } from "./process";

type Doc = { id: string; org_id: string; mime_type: string };

/** Texto de un documento: capa de texto del PDF u OCR propio para imágenes. */
export async function readDocumentText(buffer: Buffer, mime: string): Promise<{ text: string; method: "texto" | "ocr" }> {
  if (mime === "application/pdf") {
    const { text } = await extractText(await getDocumentProxy(new Uint8Array(buffer)), { mergePages: true });
    if (text.replace(/\s/g, "").length < 80) throw new Error("El PDF no tiene texto seleccionable. Subí una foto o captura del comprobante.");
    return { text, method: "texto" };
  }
  return { text: (await ocrImage(buffer)).text, method: "ocr" };
}

async function finish(supabase: SupabaseClient, jobId: string, doc: Doc, method: string, text: string, data: unknown, warnings: string[]) {
  const { error } = await supabase.from("extracted_document_data").insert({
    org_id: doc.org_id, import_job_id: jobId, extractor: "heuristica", method, raw_text: text.slice(0, 200_000),
    data, warnings: warnings.map((m) => ({ level: "warning", message: m })),
  });
  if (error) throw new Error(error.message);
  await supabase.from("import_jobs").update({ status: "revision", finished_at: new Date().toISOString(), locked_at: null }).eq("id", jobId);
}

/** Factura de proveedor → borrador de compra + renglones de OC sugeridos (requiere aprobación). */
export async function processInvoiceJob(supabase: SupabaseClient, jobId: string, doc: Doc, org: { cuit: string | null } | null, buffer: Buffer): Promise<ProcessOutcome> {
  const { text, method } = await readDocumentText(buffer, doc.mime_type);
  const { draft, review, warnings } = parseInvoiceText(text, org?.cuit);

  // Duplicado por proveedor + número
  if (draft.supplier_cuit && draft.number) {
    const { data: sup } = await supabase.from("suppliers").select("id").eq("org_id", doc.org_id).eq("cuit", draft.supplier_cuit).maybeSingle();
    if (sup) {
      const { data: dup } = await supabase.from("purchases").select("id").eq("supplier_id", sup.id).eq("number", draft.number)
        .eq("point_of_sale", draft.point_of_sale).neq("status", "anulada").maybeSingle();
      if (dup) { warnings.unshift(`Esta factura (${draft.point_of_sale}-${draft.number}) ya está registrada.`); review.push("number"); }
    }
  }

  // Sugerencias de vínculo por renglón (equivalencias confirmadas pesan más)
  const suggestions: Record<number, unknown[]> = {};
  for (let i = 0; i < draft.items.length; i++) {
    const { data } = await supabase.rpc("suggest_po_items", { p_org: doc.org_id, p_text: draft.items[i].description, p_limit: 4 });
    suggestions[i] = data ?? [];
  }
  await finish(supabase, jobId, doc, method, text, { invoice: draft, review, suggestions }, warnings);
  return { status: "revision" };
}

/** Remito / constancia → orden y cantidades sugeridas (requiere confirmación). */
export async function processRemitoJob(supabase: SupabaseClient, jobId: string, doc: Doc, buffer: Buffer): Promise<ProcessOutcome> {
  const { text, method } = await readDocumentText(buffer, doc.mime_type);
  const header = readRemitoHeader(text);
  const warnings: string[] = [];

  let poId: string | null = null;
  for (const oc of header.oc_numbers) {
    const { data } = await supabase.from("purchase_orders").select("id").eq("org_id", doc.org_id).ilike("bac_number", oc).maybeSingle();
    if (data) { poId = data.id; break; }
  }
  // Si el documento ya está ligado a una orden (subido desde la orden), se usa esa
  if (!poId) {
    const { data: d } = await supabase.from("documents").select("purchase_order_id").eq("id", doc.id).single();
    poId = d?.purchase_order_id ?? null;
  }
  let lines: ReturnType<typeof matchRemitoLines> = [];
  if (poId) {
    const { data: items } = await supabase.from("purchase_order_items").select("id, line_number, bac_code, description_original, quantity").eq("purchase_order_id", poId);
    lines = matchRemitoLines(text, items ?? []);
    if (!lines.length) warnings.push("Se identificó la orden, pero no los renglones: indicá las cantidades entregadas.");
  } else {
    warnings.push("No se encontró el número de orden en el remito: elegí la orden.");
  }
  if (header.signature_block) warnings.push("Se detectó un espacio de firma. Verificá la firma a la vista: el sistema no valida su autenticidad.");
  await finish(supabase, jobId, doc, method, text, { remito: { ...header, purchase_order_id: poId, lines } }, warnings);
  return { status: "revision" };
}
