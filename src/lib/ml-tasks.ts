import "server-only";
import { fetchMlInvoices, restockMercadoLibre, syncMercadoLibre, type MlRpc } from "@/lib/ml-api";
import { pdfLines } from "@/lib/invoice/pdf-lines";
import { parseSupplierInvoice } from "@/lib/invoice/supplier-invoice";
import { invoicePayload } from "@/lib/inbound/supplier-invoices";

const parse = async (pdf: Uint8Array, filename: string) => {
  const pages = await pdfLines(pdf);
  if (pages.flat().join("").replace(/\s/g, "").length < 80) return null;
  return invoicePayload(parseSupplierInvoice(pages, { filename }), { filename }) as unknown as Record<string, unknown>;
};

/** Todo lo automático de Mercado Libre: compras y ventas, reposición de stock y facturas de compras. Nunca tira error. */
export async function runMlTasks(rpc: MlRpc, stock: MlRpc, opts: { sync?: boolean } = {}) {
  const out: Record<string, unknown> = {};
  if (opts.sync !== false) out.sync = await syncMercadoLibre(rpc).catch((e) => ({ error: (e as Error).message }));
  out.restock = await restockMercadoLibre(rpc, stock).catch((e) => ({ error: (e as Error).message }));
  out.invoices = await fetchMlInvoices(rpc, stock, parse).catch((e) => ({ error: (e as Error).message }));
  return out;
}
