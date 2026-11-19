import { NextResponse, type NextRequest } from "next/server";
import { requireOrg } from "@/lib/session";
import { writeStyledXlsx, type Cell } from "@/lib/xlsx-styled";
import { orderRefs } from "@/lib/billing-load";
import { COLLECTION_STATUS, invoiceLabel, type InvoiceBalance } from "@/lib/billing";
import { monthLabel } from "@/lib/months";
import { todayISO } from "@/lib/format";

/** 32) Planilla mensual para el contador: facturas emitidas con su estado de cobro y los certificados de retención. */
export async function GET(req: NextRequest) {
  const s = await requireOrg();
  const q = req.nextUrl.searchParams.get("mes") ?? "";
  const ym = /^\d{4}-\d{2}$/.test(q) ? q : todayISO().slice(0, 7);
  const [y, m] = ym.split("-").map(Number);
  const next = new Date(Date.UTC(y, m, 1)).toISOString().slice(0, 10);
  const org = s.org.org_id;
  const [{ data: inv }, { data: certs }] = await Promise.all([
    s.supabase.from("invoice_balances").select("*").eq("org_id", org).gte("issue_date", `${ym}-01`).lt("issue_date", next).order("issue_date").limit(2000),
    s.supabase.from("retention_certificates").select("from_name, from_email, subject, received_at, file").eq("org_id", org)
      .gte("received_at", `${ym}-01T03:00:00Z`).lt("received_at", `${next}T03:00:00Z`).order("received_at").limit(500),
  ]);
  const rows = (inv ?? []) as InvoiceBalance[];
  const refs = await orderRefs(s.supabase, rows.map((r) => r.purchase_order_id));
  const n = (x: string | null) => Number(x ?? 0);
  const valid = rows.filter((r) => r.status !== "anulada");
  const body: Cell[][] = [
    [{ v: `Facturas emitidas · ${monthLabel(ym)}`, s: "title" }],
    [{ v: `${valid.length} facturas · generado el ${todayISO().split("-").reverse().join("/")}`, s: "subtitle" }],
    [],
    ["Fecha", "Comprobante", "Organismo", "OC", "Moneda", "Total", "Cobrado", "Retenciones", "Saldo", "Estado", "Último cobro"].map((h) => ({ v: h, s: "headDark" as const })),
    ...rows.map((r): Cell[] => {
      const o = refs.get(r.purchase_order_id);
      return [
        { v: r.issue_date.split("-").reverse().join("/"), s: "text" }, { v: invoiceLabel(r), s: "text" }, { v: o?.customer ?? "", s: "wrap" }, { v: o?.label ?? "", s: "text" },
        { v: r.currency, s: "text" }, { v: n(r.total_amount), s: "money" }, { v: n(r.cash_received), s: "money" }, { v: n(r.withholdings), s: "money" },
        { v: n(r.balance), s: n(r.balance) > 0 ? "moneyRed" : "money" },
        { v: COLLECTION_STATUS[r.collection_status]?.label ?? r.collection_status, s: r.collection_status === "vencida" ? "missing" : "text" },
        { v: r.last_payment ? r.last_payment.slice(0, 10).split("-").reverse().join("/") : "", s: "text" },
      ];
    }),
    [{ v: "Total ARS", s: "totalLabel" }, "", "", "", "",
      { v: valid.filter((r) => r.currency === "ARS").reduce((a, r) => a + n(r.total_amount), 0), s: "moneyBold" },
      { v: valid.filter((r) => r.currency === "ARS").reduce((a, r) => a + n(r.cash_received), 0), s: "moneyBold" },
      { v: valid.filter((r) => r.currency === "ARS").reduce((a, r) => a + n(r.withholdings), 0), s: "moneyBold" },
      { v: valid.filter((r) => r.currency === "ARS").reduce((a, r) => a + n(r.balance), 0), s: "moneyBold" }],
  ];
  type C = { from_name: string | null; from_email: string; subject: string | null; received_at: string; file: string | null };
  const certRows: Cell[][] = [
    [{ v: `Certificados de retención recibidos · ${monthLabel(ym)}`, s: "title" }], [],
    ["Fecha", "De", "Archivo", "Asunto"].map((h) => ({ v: h, s: "headDark" as const })),
    ...((certs ?? []) as C[]).map((c): Cell[] => [{ v: c.received_at.slice(0, 10).split("-").reverse().join("/"), s: "text" }, { v: c.from_name || c.from_email, s: "text" }, { v: c.file ?? "", s: "text" }, { v: c.subject ?? "", s: "wrap" }]),
  ];
  const xlsx = writeStyledXlsx([
    { name: "Facturas", rows: body, widths: [11, 22, 36, 16, 8, 14, 14, 13, 14, 13, 12], headerRow: 3, merges: ["A1:K1", "A2:K2"] },
    { name: "Certificados", rows: certRows, widths: [11, 30, 36, 50], headerRow: 2 },
  ]);
  return new NextResponse(Buffer.from(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="facturas-${ym}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
