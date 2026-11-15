"use server";
import { revalidatePath } from "next/cache";
import { requireOrg } from "@/lib/session";
import { friendlyDbError } from "@/lib/errors";
import { isUuid } from "@/lib/utils";
import { pdfLines } from "@/lib/invoice/pdf-lines";
import { ocrPhoto } from "@/lib/bac/ocr";
import { parseSupplierInvoice } from "@/lib/invoice/supplier-invoice";
import { invoicePayload } from "@/lib/inbound/supplier-invoices";

type R = { ok: true; message: string } | { ok: false; error: string };
const can = (role: string) => ["admin", "finanzas", "compras"].includes(role);

const REASON: Record<string, string> = {
  repetida: "Esa factura ya estaba cargada",
  "salteada:propia": "Es una factura emitida por vos, no de un proveedor",
  "salteada:no_es_a_nombre_de_la_empresa": "La factura no está a nombre de la empresa (¿es un ticket de consumidor final?)",
  "salteada:sin_cae": "No parece una factura electrónica (no tiene CAE)",
};

/** Sube una o varias facturas en PDF o foto (las que no llegaron por mail). Las fotos se leen con OCR. */
export async function uploadSupplierInvoices(form: FormData): Promise<R> {
  const s = await requireOrg();
  if (!can(s.org.role)) return { ok: false, error: "Tu rol no permite cargar facturas" };
  const files = form.getAll("files").filter((f): f is File => f instanceof File && f.size > 0).slice(0, 10);
  if (!files.length) return { ok: false, error: "Elegí al menos un PDF o una foto" };
  let nuevas = 0, items = 0;
  const problems: string[] = [];
  for (const f of files) {
    if (f.size > 1_900_000) { problems.push(`${f.name}: es muy grande (máx. 1,9 MB)`); continue; }
    const bytes = new Uint8Array(await f.arrayBuffer());
    const isPdf = Buffer.from(bytes.slice(0, 5)).toString() === "%PDF-";
    const isImg = /^image\/(jpeg|png|webp|heic|heif)$/.test(f.type) || /^\xff\xd8|^\x89PNG/.test(Buffer.from(bytes.slice(0, 4)).toString("latin1"));
    if (!isPdf && !isImg) { problems.push(`${f.name}: no es un PDF ni una foto`); continue; }
    let pages: string[][];
    try {
      if (isPdf) pages = await pdfLines(bytes);
      else pages = [(await ocrPhoto(Buffer.from(bytes))).text.split(/\r?\n/).filter((l) => l.trim())];
    } catch { problems.push(`${f.name}: no se pudo abrir`); continue; }
    if (pages.flat().join("").replace(/\s/g, "").length < 80) { problems.push(`${f.name}: ${isPdf ? "es una imagen escaneada, sin texto: subí una foto de la factura" : "no se pudo leer la foto (sacala más de cerca, derecha y con buena luz)"}`); continue; }
    const inv = parseSupplierInvoice(pages, { filename: f.name });
    const { data, error } = await s.supabase.rpc("upload_supplier_invoice", { p_org: s.org.org_id, p_inv: invoicePayload(inv, { filename: f.name.slice(0, 200) }) });
    if (error) { problems.push(`${f.name}: ${friendlyDbError(error)}`); continue; }
    if (data === "nueva") { nuevas++; items += inv.items.length; } else problems.push(`${f.name}: ${REASON[String(data)] ?? String(data)}`);
  }
  revalidatePath("/precios-proveedores");
  if (!nuevas) return { ok: false, error: problems.join(" · ") || "No se cargó nada" };
  return { ok: true, message: `${nuevas} factura${nuevas === 1 ? "" : "s"} cargada${nuevas === 1 ? "" : "s"} · ${items} producto${items === 1 ? "" : "s"}${problems.length ? ` · ${problems.join(" · ")}` : ""}` };
}

export async function hideSupplierInvoice(id: string, hidden: boolean): Promise<R> {
  const s = await requireOrg();
  if (!can(s.org.role)) return { ok: false, error: "Tu rol no permite modificar facturas" };
  if (!isUuid(id)) return { ok: false, error: "Factura inválida" };
  const { error } = await s.supabase.rpc("hide_supplier_invoice", { p_id: id, p_hidden: hidden });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/precios-proveedores");
  return { ok: true, message: hidden ? "Factura ocultada" : "Factura visible otra vez" };
}
