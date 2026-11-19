import { NextResponse, type NextRequest } from "next/server";
import { requireOrg } from "@/lib/session";
import { writeStyledXlsx, type Cell } from "@/lib/xlsx-styled";
import { rubroLabel, summarize } from "@/lib/ml-purchases";
import { currentArYm, loadMlPurchases } from "@/lib/ml-purchases-load";
import { monthLabel } from "@/lib/months";

/** Planilla mensual de compras de Mercado Libre para el contador. */
export async function GET(req: NextRequest) {
  const s = await requireOrg();
  const q = req.nextUrl.searchParams.get("mes") ?? "";
  const ym = /^\d{4}-\d{2}$/.test(q) ? q : currentArYm();
  const { orders, invoices } = await loadMlPurchases(s.supabase, s.org.org_id, ym);
  const sum = summarize(orders, invoices);
  const head = ["Fecha", "Producto", "Vendedor", "Rubro", "Factura", "Razón social", "Total pagado", "Neto", "IVA crédito", "Percepciones", "Envío", "IVA no recuperable"];
  const rows: Cell[][] = [
    [{ v: `Compras en Mercado Libre · ${monthLabel(ym)}`, s: "title" }],
    [{ v: `${sum.n} compras · ${sum.withA} con factura A · ${sum.noInvoice} sin factura`, s: "subtitle" }],
    [],
    head.map((h) => ({ v: h, s: "headDark" as const })),
    ...sum.rows.map((r): Cell[] => [
      { v: (r.o.ordered_at ?? r.o.created_at).slice(0, 10).split("-").reverse().join("/"), s: "text" },
      { v: r.o.title, s: "wrap" }, { v: r.o.counterpart ?? "", s: "text" }, { v: rubroLabel(r.rubro), s: "text" },
      r.letter ? { v: r.letter, s: "text" } : { v: "Sin factura", s: "missing" },
      { v: r.inv?.supplier_name ?? "", s: "text" },
      { v: r.total, s: "money" }, { v: r.inv?.letter === "A" ? Number(r.inv.net ?? 0) : null, s: "money" },
      { v: r.vat || null, s: "moneyGreen" }, { v: r.perc || null, s: "money" }, { v: r.ship || null, s: "money" }, { v: r.lostVat || null, s: "moneyRed" },
    ]),
    [
      { v: "Total", s: "totalLabel" }, "", "", "", "", "",
      { v: sum.total, s: "moneyBold" }, "", { v: sum.vat, s: "moneyBold" }, { v: sum.perc, s: "moneyBold" }, { v: sum.shipping, s: "moneyBold" }, { v: sum.lostVat, s: "moneyBold" },
    ],
  ];
  const rubros: Cell[][] = [
    [{ v: `Gasto por rubro · ${monthLabel(ym)}`, s: "title" }], [],
    [{ v: "Rubro", s: "headDark" }, { v: "Compras", s: "headDark" }, { v: "Total", s: "headDark" }],
    ...sum.byRubro.map(([k, x]): Cell[] => [{ v: rubroLabel(k), s: "text" }, { v: x.n, s: "int" }, { v: x.total, s: "money" }]),
  ];
  const xlsx = writeStyledXlsx([
    { name: "Compras", rows, widths: [11, 46, 20, 22, 11, 28, 14, 14, 14, 13, 12, 16], headerRow: 3, merges: ["A1:L1", "A2:L2"] },
    { name: "Por rubro", rows: rubros, widths: [28, 10, 16], headerRow: 2 },
  ]);
  return new NextResponse(Buffer.from(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="compras-mercadolibre-${ym}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
