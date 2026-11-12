import { NextResponse, type NextRequest } from "next/server";
import { zipSync, strToU8 } from "fflate";
import { getSession } from "@/lib/session";
import { libroCompras, libroVentas, type LibroVoucher } from "@/lib/libro-iva";

/** ZIP con los 4 archivos del Libro IVA Digital del mes (ventas y compras, comprobantes y alícuotas). */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s?.org) return NextResponse.json({ error: "No autorizado" }, { status: 401 });
  if (!["admin", "finanzas"].includes(s.org.role)) return NextResponse.json({ error: "Sin permisos" }, { status: 403 });
  const m = req.nextUrl.searchParams.get("m") ?? "";
  if (!/^\d{4}-\d{2}$/.test(m)) return NextResponse.json({ error: "Mes inválido" }, { status: 400 });
  const [y, mm] = m.split("-").map(Number);
  const next = new Date(Date.UTC(y, mm, 1)).toISOString().slice(0, 10);
  const rows: (LibroVoucher & { direction: string })[] = [];
  for (let from = 0; from < 50000; from += 1000) {
    const { data, error } = await s.supabase.from("arca_vouchers")
      .select("direction, issue_date, voucher_type, point_of_sale, number, doc_type, doc_number, name, currency, exchange_rate, net_taxed, net_untaxed, exempt, other_taxes, vat, total, vat_detail")
      .eq("org_id", s.org.org_id).gte("issue_date", `${m}-01`).lt("issue_date", next).order("id").range(from, from + 999);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...((data ?? []) as typeof rows));
    if (!data || data.length < 1000) break;
  }
  const ventas = libroVentas(rows.filter((r) => r.direction === "emitido"));
  const compras = libroCompras(rows.filter((r) => r.direction === "recibido"));
  const file = (lines: string[]) => strToU8(lines.length ? lines.join("\r\n") + "\r\n" : "");
  const per = m.replace("-", "");
  const zip = zipSync({
    [`LIBRO_IVA_DIGITAL_VENTAS_CBTE_${per}.txt`]: file(ventas.cbte),
    [`LIBRO_IVA_DIGITAL_VENTAS_ALICUOTAS_${per}.txt`]: file(ventas.alicuotas),
    [`LIBRO_IVA_DIGITAL_COMPRAS_CBTE_${per}.txt`]: file(compras.cbte),
    [`LIBRO_IVA_DIGITAL_COMPRAS_ALICUOTAS_${per}.txt`]: file(compras.alicuotas),
  });
  return new NextResponse(Buffer.from(zip), {
    headers: { "Content-Type": "application/zip", "Content-Disposition": `attachment; filename="libro-iva-digital-${per}.zip"`, "Cache-Control": "no-store" },
  });
}
