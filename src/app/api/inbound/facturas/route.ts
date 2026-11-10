import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import { z } from "zod";
import { pdfLines } from "@/lib/invoice/pdf-lines";
import { parseSupplierInvoice } from "@/lib/invoice/supplier-invoice";
import { invoicePayload } from "@/lib/inbound/supplier-invoices";

/**
 * Recibe las facturas de proveedores (PDF adjunto) que manda el script de Gmail.
 * Lee el PDF acá y guarda sólo los datos (proveedor, fecha, productos y precios); el PDF no se guarda.
 */
export const maxDuration = 60;

const cut = (n: number) => z.preprocess((v) => (v == null ? "" : String(v).slice(0, n)), z.string());
const Inv = z.object({
  id: z.string().min(1).max(200),
  from: cut(500),
  subject: cut(1000),
  date: cut(60),
  filename: cut(200),
  pdf: z.string().min(100).max(6_000_000),
});
const Body = z.object({ token: z.string().min(32).max(200), invoices: z.array(z.unknown()).max(20) });

export async function POST(req: NextRequest) {
  let raw: z.infer<typeof Body>;
  try {
    raw = Body.parse(await req.json());
  } catch {
    return NextResponse.json({ error: "Formato inválido" }, { status: 400 });
  }
  const sb = createClient(process.env.NEXT_PUBLIC_SUPABASE_URL!, process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY!, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
  // valida el token antes de leer PDFs
  const check = await sb.rpc("ingest_supplier_invoices", { p_token: raw.token, p_invoices: [] });
  if (check.error) return NextResponse.json({ error: "Token inválido" }, { status: 401 });

  const payloads: unknown[] = [];
  let unreadable = 0;
  for (const r of raw.invoices.map((x) => Inv.safeParse(x))) {
    if (!r.success) continue;
    const inv = r.data;
    try {
      const bytes = new Uint8Array(Buffer.from(inv.pdf, "base64"));
      if (bytes.length < 200 || Buffer.from(bytes.slice(0, 5)).toString() !== "%PDF-") { unreadable++; continue; }
      const pages = await pdfLines(bytes);
      if (pages.flat().join("").replace(/\s/g, "").length < 80) { unreadable++; continue; } // escaneado sin texto
      const parsed = parseSupplierInvoice(pages, { subject: inv.subject, filename: inv.filename });
      payloads.push(invoicePayload(parsed, { mail_id: inv.id, mail_from: inv.from, mail_subject: inv.subject, mail_date: inv.date, filename: inv.filename }));
    } catch {
      unreadable++;
    }
  }
  if (!payloads.length) return NextResponse.json({ ok: true, nuevas: 0, ilegibles: unreadable });
  const res = await sb.rpc("ingest_supplier_invoices", { p_token: raw.token, p_invoices: payloads });
  if (res.error) return NextResponse.json({ error: res.error.message }, { status: 500 });
  return NextResponse.json({ ok: true, ...(res.data as object), ilegibles: unreadable });
}
