import { NextResponse, type NextRequest } from "next/server";
import { requireOrg } from "@/lib/session";
import { writeStyledXlsx } from "@/lib/xlsx-styled";
import { buildCatalog, catalogWorkbook } from "@/lib/catalog";
import { catalogParams, loadCatalog } from "@/lib/catalog-load";
import { todayISO } from "@/lib/format";

/** Excel del catálogo (con o sin precios, con o sin descripción, todo o un rubro). */
export async function GET(req: NextRequest) {
  const s = await requireOrg();
  const p = catalogParams(req.nextUrl.searchParams);
  const { rows, company } = await loadCatalog(s.supabase, s.org.org_id);
  const groups = buildCatalog(rows).filter((g) => !p.rubro || g.rubro === p.rubro);
  const today = todayISO();
  const xlsx = writeStyledXlsx(catalogWorkbook(groups, { prices: p.prices, specs: p.specs, title: p.title, company, date: today }));
  return new NextResponse(Buffer.from(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="catalogo-${p.rubro ? p.rubro.toLowerCase().replace(/\W+/g, "-") + "-" : ""}${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
