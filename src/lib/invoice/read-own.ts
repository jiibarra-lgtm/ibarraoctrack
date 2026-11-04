import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { extractText, getDocumentProxy } from "unpdf";
import { parseInvoiceText } from "./parse";

export type OwnInvoiceDraft = {
  invoice_type: string; point_of_sale: string; number: string; issue_date: string;
  net_amount: string; vat_amount: string; other_taxes: string; total_amount: string; cae: string;
};

const digits = (s: string) => (s.replace(/\D/g, "") ? String(Number(s.replace(/\D/g, ""))) : "");

/**
 * Lee una factura emitida (PDF de AFIP/ARCA con texto) ya guardada como documento.
 * Sólo usa la capa de texto: las facturas electrónicas siempre la tienen.
 */
export async function readOwnInvoice(sb: SupabaseClient, documentId: string, ownCuit: string | null): Promise<OwnInvoiceDraft | null> {
  const { data: doc } = await sb.from("documents").select("storage_path, mime_type").eq("id", documentId).maybeSingle();
  if (!doc || doc.mime_type !== "application/pdf") return null;
  const { data: blob } = await sb.storage.from("documents").download(doc.storage_path);
  if (!blob) return null;
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(await blob.arrayBuffer())), { mergePages: true });
  if (text.replace(/\s/g, "").length < 80) return null;
  const { draft } = parseInvoiceText(text, ownCuit);
  const type = draft.doc_type.startsWith("factura_") ? draft.doc_type.slice(-1).toUpperCase() : "B";
  return {
    invoice_type: type, point_of_sale: digits(draft.point_of_sale), number: digits(draft.number), issue_date: draft.invoice_date,
    net_amount: draft.net_amount, vat_amount: draft.vat_amount, other_taxes: draft.other_taxes, total_amount: draft.total_amount, cae: draft.cae,
  };
}
