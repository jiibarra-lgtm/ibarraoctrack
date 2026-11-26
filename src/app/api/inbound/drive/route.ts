import { NextResponse, type NextRequest } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { z } from "zod";
import { pdfLines } from "@/lib/invoice/pdf-lines";
import { parseSupplierInvoice } from "@/lib/invoice/supplier-invoice";
import { invoicePayload } from "@/lib/inbound/supplier-invoices";
import { parseCm03 } from "@/lib/iibb-cm03";

/**
 * Lee facturas de proveedores desde archivos de Google Drive compartidos por link.
 * Sólo lee y devuelve los datos (no guarda nada): el guardado lo hace la base con store_supplier_invoice.
 * Protegido con la clave DRIVE_IMPORT_KEY (se borra cuando termina la importación).
 */
export const maxDuration = 300;

const Body = z.object({ files: z.array(z.object({ id: z.string().regex(/^[\w-]{20,80}$/), name: z.string().max(300) })).min(1).max(40) });

function authorized(req: NextRequest) {
  const want = process.env.DRIVE_IMPORT_KEY ?? "";
  const got = req.headers.get("x-import-key") ?? "";
  if (want.length < 32 || got.length !== want.length) return false;
  return timingSafeEqual(Buffer.from(got), Buffer.from(want));
}

async function download(id: string) {
  const r = await fetch(`https://drive.usercontent.google.com/download?id=${id}&export=download&confirm=t`, { redirect: "follow", cache: "no-store" });
  if (!r.ok) throw new Error(`descarga ${r.status}`);
  const b = new Uint8Array(await r.arrayBuffer());
  if (b.length > 15_000_000) throw new Error("muy grande");
  return b;
}

export async function POST(req: NextRequest) {
  if (!authorized(req)) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  let body: z.infer<typeof Body>;
  try { body = Body.parse(await req.json()); } catch { return NextResponse.json({ error: "Formato inválido" }, { status: 400 }); }

  const results = [];
  for (const f of body.files) {
    try {
      const bytes = await download(f.id);
      if (Buffer.from(bytes.slice(0, 5)).toString() !== "%PDF-") { results.push({ id: f.id, name: f.name, status: "no_pdf" }); continue; }
      const pages = await pdfLines(bytes);
      const text = pages.flat().join(" ");
      if (text.replace(/\s/g, "").length < 80) { results.push({ id: f.id, name: f.name, status: "sin_texto" }); continue; }
      if (parseCm03(pages.flat())) { results.push({ id: f.id, name: f.name, status: "cm03" }); continue; }
      const inv = parseSupplierInvoice(pages, { filename: f.name });
      results.push({
        id: f.id, name: f.name, status: "ok", head: text.slice(0, 160),
        payload: invoicePayload(inv, { mail_id: `drive:${f.id}`, mail_from: "", mail_subject: "Carpeta de Drive «claude facturas»", mail_date: "", filename: f.name.slice(0, 200) }),
      });
    } catch (e) {
      results.push({ id: f.id, name: f.name, status: "error", error: (e as Error).message.slice(0, 200) });
    }
  }
  return NextResponse.json({ results });
}
