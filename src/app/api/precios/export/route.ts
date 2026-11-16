import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/session";
import { writeStyledXlsx } from "@/lib/xlsx-styled";
import { advise, type AdviceInput } from "@/lib/price-advice";
import { priceWorkbook } from "@/lib/price-export";
import { todayISO } from "@/lib/format";

/** Excel con cuadros por situación: dónde te ganan, cuánto bajar, cuánto subir y qué stock pedir. */
export async function GET() {
  const s = await requireOrg();
  const { data, error } = await s.supabase.from("convenio_lines")
    .select("contract_number, line_number, option_number, product_name, my_current_price, best_other_price, cost, my_stock, my_stock_balance")
    .eq("org_id", s.org.org_id).eq("is_mine", true).order("contract_number").order("line_number").order("option_number").limit(5000);
  if (error) return NextResponse.json({ error: "No se pudieron leer los precios" }, { status: 500 });
  const today = todayISO();
  const xlsx = writeStyledXlsx(priceWorkbook(((data ?? []) as AdviceInput[]).map(advise), today));
  return new NextResponse(Buffer.from(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="precios-y-stock-${today}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
