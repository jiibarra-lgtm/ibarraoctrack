import "server-only";
import { fetchMlInvoices, restockMercadoLibre, syncMercadoLibre, type MlRpc } from "@/lib/ml-api";
import { mlClient } from "@/lib/ml/client";
import { runMlPro } from "@/lib/ml/sync";
import { pdfLines } from "@/lib/invoice/pdf-lines";
import { parseSupplierInvoice } from "@/lib/invoice/supplier-invoice";
import { invoicePayload } from "@/lib/inbound/supplier-invoices";

const parse = async (pdf: Uint8Array, filename: string) => {
  const pages = await pdfLines(pdf);
  if (pages.flat().join("").replace(/\s/g, "").length < 80) return null;
  return invoicePayload(parseSupplierInvoice(pages, { filename }), { filename }) as unknown as Record<string, unknown>;
};

/** Todo lo automático de Mercado Libre: compras y ventas, reposición de stock y facturas de compras. Nunca tira error. */
export async function runMlTasks(rpc: MlRpc, stock: MlRpc, opts: { sync?: boolean; pro?: MlRpc } = {}) {
  const out: Record<string, unknown> = {};
  if (opts.sync !== false) out.sync = await syncMercadoLibre(rpc).catch((e) => ({ error: (e as Error).message }));
  out.restock = await restockMercadoLibre(rpc, stock).catch((e) => ({ error: (e as Error).message }));
  out.invoices = await fetchMlInvoices(rpc, stock, parse).catch((e) => ({ error: (e as Error).message }));
  // Sección Mercado Libre: publicaciones, preguntas, reclamos, reputación, competencia, repricing, A/B
  if (opts.pro) {
    const ml = await mlClient(rpc).catch(() => null);
    if (ml) out.pro = await runMlPro(ml, opts.pro).catch((e) => ({ error: (e as Error).message }));
  }
  return out;
}
