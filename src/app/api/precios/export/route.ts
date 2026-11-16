import { NextResponse } from "next/server";
import { requireOrg } from "@/lib/session";
import { writeXlsx } from "@/lib/xlsx-write";
import { advise, STATUS_LABEL, type AdviceInput } from "@/lib/price-advice";
import { todayISO } from "@/lib/format";

const SHORT: Record<string, string> = { "623-20-CM26": "Limpieza", "623-26-CM26": "Contenedores", "623-38-CM26": "Tocador y perfumería", "623-43-CM26": "Bazar", "623-36-CM26": "Bazar (Lotería)" };
const r = (v: number | null, d = 2) => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d);

/** Excel con qué hacer en cada renglón: cuánto te ganan, cuánto bajar o subir, ganancia y stock. */
export async function GET() {
  const s = await requireOrg();
  const { data, error } = await s.supabase.from("convenio_lines")
    .select("contract_number, line_number, option_number, product_name, my_current_price, best_other_price, cost, my_stock, my_stock_balance")
    .eq("org_id", s.org.org_id).eq("is_mine", true).order("contract_number").order("line_number").order("option_number").limit(5000);
  if (error) return NextResponse.json({ error: "No se pudieron leer los precios" }, { status: 500 });
  const rows = ((data ?? []) as AdviceInput[]).map(advise);
  const order = { te_ganan: 0, ganas: 1, sin_competencia: 2, sin_precio: 3 } as const;
  const conv = (k: string) => SHORT[k] ?? k;

  const precios = [[
    "Convenio", "Renglón", "Producto", "Estado", "Mi precio", "Mejor otro", "Te ganan por $", "Te ganan por %",
    "Precio sugerido", "Bajar (−) / subir (+) $", "Mi costo c/IVA", "Precio mínimo (costo + 5%)", "¿Te da para bajar?",
    "Ganancia actual %", "Ganancia con sugerido %", "Qué hacer",
  ], ...rows.slice().sort((a, b) => order[a.status] - order[b.status] || (b.beatPct ?? 0) - (a.beatPct ?? 0)).map((a) => [
    conv(a.contract_number), a.option_number > 1 ? `${a.line_number}.${a.option_number}` : a.line_number, a.product_name, STATUS_LABEL[a.status],
    r(a.price), r(a.best), r(a.beatBy), r(a.beatPct, 1), r(a.target), r(a.move), r(a.costVat), r(a.minPrice),
    a.canLower === null ? "" : a.canLower ? "Sí" : "No", r(a.marginNow, 1), r(a.marginTarget, 1), a.action,
  ])];

  const stock = [[
    "Convenio", "Renglón", "Producto", "Stock ofertado", "Vendido", "Queda", "Queda %", "Qué hacer", "Pedir incremento de",
  ], ...rows.filter((a) => a.offered !== null).sort((a, b) => (a.leftPct ?? 100) - (b.leftPct ?? 100)).map((a) => [
    conv(a.contract_number), a.option_number > 1 ? `${a.line_number}.${a.option_number}` : a.line_number, a.product_name,
    a.offered, a.sold, a.left, r(a.leftPct, 1),
    a.stockAction === "agotado" ? "Agotado: pedir incremento" : a.stockAction === "pedir_incremento" ? "Queda poco: pedir incremento" : "Alcanza", a.stockAdd,
  ])];

  const count = (k: keyof typeof order) => rows.filter((a) => a.status === k).length;
  const resumen = [
    ["Resumen de precios y stock", todayISO()],
    ["Renglones tuyos", rows.length],
    ["Te ganan en precio", count("te_ganan")],
    ["  de esos, te da para bajar", rows.filter((a) => a.canLower === true).length],
    ["  de esos, no te da (quedarías a pérdida)", rows.filter((a) => a.canLower === false).length],
    ["  de esos, sin costo cargado", rows.filter((a) => a.status === "te_ganan" && a.costVat === null).length],
    ["Ganás y podés subir", rows.filter((a) => a.status === "ganas" && (a.move ?? 0) > 0).length],
    ["Sin competencia", count("sin_competencia")],
    ["Stock agotado", rows.filter((a) => a.stockAction === "agotado").length],
    ["Stock bajo (pedir incremento)", rows.filter((a) => a.stockAction === "pedir_incremento").length],
    [],
    ["Cómo se calcula"],
    ["Todos los precios son con IVA, como en el BAC. El costo es el que cargaste en Productos."],
    ["Precio sugerido: 1% abajo del más barato de los demás. Si ya sos el más barato, 1% abajo del siguiente (lo que podés subir)."],
    ["Precio mínimo: tu costo con IVA más 5%. Si el sugerido queda abajo de eso, no te conviene bajar."],
    ["Stock: se sugiere pedir incremento cuando queda menos del 20% de lo ofertado o menos de 10 unidades."],
  ];

  const xlsx = writeXlsx([{ name: "Resumen", rows: resumen }, { name: "Precios", rows: precios }, { name: "Stock", rows: stock }]);
  return new NextResponse(Buffer.from(xlsx), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="precios-y-stock-${todayISO()}.xlsx"`,
      "Cache-Control": "no-store",
    },
  });
}
