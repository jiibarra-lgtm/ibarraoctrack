import type { Advice } from "@/lib/price-advice";
import { MIN_MARGIN, UNDERCUT } from "@/lib/price-advice";
import type { Cell, Style, StyledSheet } from "@/lib/xlsx-styled";

const SHORT: Record<string, string> = { "623-20-CM26": "Limpieza", "623-26-CM26": "Contenedores", "623-38-CM26": "Tocador y perfumería", "623-43-CM26": "Bazar", "623-36-CM26": "Bazar (Lotería)" };
export const convName = (k: string) => SHORT[k] ?? k;
const c = (v: string | number | null | undefined, s: Style): Cell => ({ v: v === null || v === undefined || (typeof v === "number" && !Number.isFinite(v)) ? null : v, s });
const money = (v: number | null) => c(v === null ? null : Math.round(v * 100) / 100, "money");
const pct = (v: number | null, s: Style = "pct") => c(v === null ? null : Math.round(v * 10) / 1000, s); // v viene en %, Excel usa fracción
const line = (a: Advice) => c(a.option_number > 1 ? `${a.line_number}.${a.option_number}` : a.line_number, "text");
const head = (s: Style, labels: string[]) => labels.map((l) => c(l, s));
/** Costo con IVA, o un aviso claro si todavía no se cargó. */
const costCell = (a: Advice) => (a.costVat === null ? c("Falta tu costo", "missing") : money(a.costVat));
/** Ganancia %; si no hay costo no se puede calcular. */
const marginCell = (a: Advice, v: number | null, s: Style = "pct") => (a.costVat === null ? c("Falta tu costo", "missing") : pct(v, s));
const bestCell = (a: Advice) => (a.best === null ? c("Nadie más", "text") : money(a.best));

/** Una hoja con título, explicación y un cuadro con encabezado de color. */
function table(name: string, title: string, note: string, headStyle: Style, labels: string[], widths: number[], body: Cell[][], total?: Cell[]): StyledSheet {
  const rows: Cell[][] = [[c(title, "title")], [c(note, "subtitle")], [], head(headStyle, labels), ...body];
  if (!body.length) rows.push([c("No hay renglones en esta situación.", "subtitle")]);
  else if (total) rows.push(total);
  return { name, rows, widths, headerRow: 3, merges: [`A2:${String.fromCharCode(64 + Math.min(labels.length, 26))}2`] };
}

export function priceWorkbook(all: Advice[], today: string): StyledSheet[] {
  const lower = all.filter((a) => a.status === "te_ganan" && a.canLower === true).sort((a, b) => (b.beatPct ?? 0) - (a.beatPct ?? 0));
  const cant = all.filter((a) => a.status === "te_ganan" && a.canLower === false).sort((a, b) => (b.beatPct ?? 0) - (a.beatPct ?? 0));
  const noCost = all.filter((a) => a.status === "te_ganan" && a.canLower === null).sort((a, b) => (b.beatPct ?? 0) - (a.beatPct ?? 0));
  const raise = all.filter((a) => a.status === "ganas" && (a.move ?? 0) > 0).sort((a, b) => (b.move ?? 0) / (b.price ?? 1) - (a.move ?? 0) / (a.price ?? 1));
  const keep = all.filter((a) => (a.status === "ganas" && !((a.move ?? 0) > 0)) || a.status === "sin_competencia");
  const stock = all.filter((a) => a.stockAction === "agotado" || a.stockAction === "pedir_incremento").sort((a, b) => (a.leftPct ?? 0) - (b.leftPct ?? 0));
  const base = (a: Advice) => [c(convName(a.contract_number), "text"), line(a), c(a.product_name, "wrap")];
  const W = [20, 9, 46];

  // ---------- Resumen ----------
  const sit: [string, number, string, Style][] = [
    ["Te ganan y te da para bajar", lower.length, "Bajá el precio → hoja «1 Bajá el precio»", "moneyRed"],
    ["Te ganan y NO te da (quedarías a pérdida)", cant.length, "Conseguí mejor costo o dejalo → hoja «2 No te da»", "moneyRed"],
    ["Te ganan, pero no cargaste el costo", noCost.length, "Cargá el costo en Productos → hoja «3 Sin costo»", "moneyRed"],
    ["Ganás y podés subir el precio", raise.length, "Subí el precio → hoja «4 Podés subir»", "moneyGreen"],
    ["Ganás o sin competencia: dejalo así", keep.length, "No tocar → hoja «5 Dejalo así»", "moneyGreen"],
    ["Stock agotado o bajo", stock.length, "Pedí incremento → hoja «6 Stock»", "moneyRed"],
    ["Renglones sin tu costo cargado", all.filter((a) => a.costVat === null).length, "Sin costo no se puede calcular la ganancia: cargalo en Productos (hoja «Todos», filtrá «Falta tu costo»)", "moneyRed"],
  ];
  const convs = [...new Set(all.map((a) => a.contract_number))].sort();
  const resumen: Cell[][] = [
    [c(`Precios y stock · ${today.split("-").reverse().join("/")}`, "title")],
    [c("Todos los precios son con IVA, como en el BAC. Tu costo es el que cargaste en Productos.", "subtitle")],
    [],
    [...head("headDark", ["Situación", "Renglones", "Qué hacer"]), c("", "headDark"), c("", "headDark"), c("", "headDark")],
    ...sit.map(([l, n, w]) => [c(l, "label"), c(n, "int"), c(w, "text"), c("", "text"), c("", "text"), c("", "text")]),
    [c("Total de renglones tuyos", "totalLabel"), c(all.length, "intBold"), c("", "totalLabel"), c("", "totalLabel"), c("", "totalLabel"), c("", "totalLabel")],
    [],
    [],
    head("headBlue", ["Convenio", "Renglones", "Te ganan", "Ganás", "Podés subir", "Stock bajo"]),
    ...convs.map((k) => {
      const xs = all.filter((a) => a.contract_number === k);
      return [c(`${convName(k)} (${k})`, "label"), c(xs.length, "int"), c(xs.filter((a) => a.status === "te_ganan").length, "int"),
        c(xs.filter((a) => a.status === "ganas").length, "int"), c(xs.filter((a) => a.status === "ganas" && (a.move ?? 0) > 0).length, "int"),
        c(xs.filter((a) => a.stockAction && a.stockAction !== "ok").length, "int")];
    }),
    [],
    [],
    [c("Cómo se calcula", "label")],
    [c(`Precio para ganar: ${UNDERCUT * 100}% abajo del más barato de los demás proveedores.`, "subtitle")],
    [c(`Podés subir: hasta ${UNDERCUT * 100}% abajo del siguiente proveedor, así seguís siendo el más barato.`, "subtitle")],
    [c(`Tu mínimo: tu costo con IVA más ${MIN_MARGIN * 100}%. Si para ganar tenés que ir abajo de eso, no te conviene.`, "subtitle")],
    [c("Ganancia %: (precio − tu costo) ÷ tu costo, todo con IVA.", "subtitle")],
    [c("Stock: pedí incremento cuando queda menos del 20% de lo ofertado o menos de 10 unidades.", "subtitle")],
  ];

  const todos = table("Todos", "Todos tus renglones",
    "Todos los renglones que ofertás, con tu precio, el mejor de los demás, tu costo y qué hacer. Usá los filtros de cada columna.", "headDark",
    ["Convenio", "Renglón", "Producto", "Situación", "Tu precio", "Mejor otro", "Diferencia $", "Diferencia %", "Precio sugerido", "Tu costo c/IVA", "Ganancia por unidad $", "Ganancia %", "Stock queda", "Qué hacer"],
    [...W, 15, 13, 13, 12, 11, 13, 14, 14, 11, 11, 70],
    all.map((a) => {
      const diff = a.price !== null && a.best !== null ? a.price - a.best : null;
      return [...base(a), c(a.status === "te_ganan" ? (a.canLower === false ? "Te ganan (no te da)" : "Te ganan") : a.status === "ganas" ? "Ganás" : a.status === "sin_competencia" ? "Sin competencia" : "Sin precio", a.status === "te_ganan" ? "moneyRed" : "text"),
        money(a.price), bestCell(a), c(diff === null ? null : Math.round(diff * 100) / 100, diff !== null && diff > 0 ? "moneyRed" : "moneyGreen"),
        pct(a.price !== null && a.best ? (a.price / a.best - 1) * 100 : null, diff !== null && diff > 0 ? "pctRed" : "pctGreen"),
        money(a.target), costCell(a), a.costVat === null ? c("Falta tu costo", "missing") : money(a.price !== null ? a.price - a.costVat : null), marginCell(a, a.marginNow),
        c(a.left, a.stockAction === "agotado" ? "moneyRed" : "int"), c(a.action + (a.costVat === null ? " Cargá tu costo en Productos para ver la ganancia." : ""), "wrap")];
    }));

  const sumMoney = (xs: Advice[], f: (a: Advice) => number | null) => Math.round(xs.reduce((s, a) => s + (f(a) ?? 0), 0) * 100) / 100;

  return [
    { name: "Resumen", rows: resumen, widths: [44, 12, 14, 12, 14, 12], merges: ["A2:F2", ...Array.from({ length: sit.length + 2 }, (_, i) => `C${i + 4}:F${i + 4}`), ...[0, 1, 2, 3, 4].map((i) => `A${resumen.length - 4 + i}:F${resumen.length - 4 + i}`)] },
    todos,
    table("1 Bajá el precio", "Te ganan y te da para bajar",
      "Otro proveedor está más barato. Bajando al precio nuevo quedás primero y seguís ganando.", "headRed",
      ["Convenio", "Renglón", "Producto", "Tu precio", "Mejor otro", "Te ganan por $", "Te ganan por %", "Bajá $", "Precio nuevo", "Tu costo c/IVA", "Ganancia hoy %", "Ganancia con precio nuevo %"],
      [...W, 13, 13, 13, 11, 11, 13, 14, 14, 14],
      lower.map((a) => [...base(a), money(a.price), money(a.best), c(a.beatBy, "moneyRed"), pct(a.beatPct, "pctRed"), c(-(a.move ?? 0), "moneyRed"),
        c(a.target, "moneyBold"), costCell(a), marginCell(a, a.marginNow), marginCell(a, a.marginTarget, "pctGreen")])),
    table("2 No te da", "Te ganan y no te da para bajar",
      "Para quedar primero tendrías que vender abajo de tu mínimo. Conseguí mejor costo o dejá el renglón.", "headGrey",
      ["Convenio", "Renglón", "Producto", "Tu precio", "Mejor otro", "Te ganan por %", "Para ganar irías a", "Tu mínimo", "Tu costo c/IVA", "Tu costo tendría que bajar $"],
      [...W, 13, 13, 11, 14, 13, 13, 14],
      cant.map((a) => [...base(a), money(a.price), money(a.best), pct(a.beatPct, "pctRed"), money(a.target), c(a.minPrice, "moneyBold"), money(a.costVat),
        c(a.costVat !== null && a.target !== null ? a.costVat - a.target / (1 + MIN_MARGIN) : null, "moneyRed")])),
    table("3 Sin costo", "Te ganan, pero falta tu costo",
      "Cargá el costo en Productos para saber si te conviene bajar.", "headAmber",
      ["Convenio", "Renglón", "Producto", "Tu precio", "Mejor otro", "Te ganan por $", "Te ganan por %", "Precio para ganar"],
      [...W, 13, 13, 13, 11, 14],
      noCost.map((a) => [...base(a), money(a.price), money(a.best), c(a.beatBy, "moneyRed"), pct(a.beatPct, "pctRed"), c(a.target, "moneyBold")])),
    table("4 Podés subir", "Ganás y podés subir el precio",
      "Sos el más barato con margen hasta el siguiente. Subiendo al precio nuevo seguís primero y ganás más por unidad.", "headGreen",
      ["Convenio", "Renglón", "Producto", "Tu precio", "Siguiente proveedor", "Subí $", "Precio nuevo", "Ganancia hoy %", "Ganancia con precio nuevo %"],
      [...W, 13, 14, 12, 13, 14, 14],
      raise.map((a) => [...base(a), money(a.price), money(a.best), c(a.move, "moneyGreen"), c(a.target, "moneyBold"), marginCell(a, a.marginNow), marginCell(a, a.marginTarget, "pctGreen")]),
      [c("Total", "totalLabel"), c("", "totalLabel"), c(`${raise.length} renglones`, "totalLabel"), c("", "totalLabel"), c("", "totalLabel"), c(sumMoney(raise, (a) => a.move), "moneyBold"), c("", "totalLabel"), c("", "totalLabel"), c("", "totalLabel")]),
    table("5 Dejalo así", "Ganás o no tenés competencia",
      "Ya sos el más barato y estás pegado al siguiente, o nadie más oferta el renglón.", "headBlue",
      ["Convenio", "Renglón", "Producto", "Tu precio", "Siguiente proveedor", "Tu costo c/IVA", "Ganancia %", "Situación"],
      [...W, 13, 14, 14, 14, 18],
      keep.map((a) => [...base(a), money(a.price), bestCell(a), costCell(a), marginCell(a, a.marginNow), c(a.status === "sin_competencia" ? "Sin competencia" : "Ganás", "text")])),
    table("6 Stock", "Stock para pedir incremento",
      "Renglones a los que les queda poco stock en el convenio. Pedí el incremento en la próxima ventana de stock.", "headAmber",
      ["Convenio", "Renglón", "Producto", "Ofertado", "Vendido", "Queda", "Queda %", "Estado", "Pedí incremento de"],
      [...W, 11, 11, 11, 10, 16, 14],
      stock.map((a) => [...base(a), c(a.offered, "int"), c(a.sold, "int"), c(a.left, a.stockAction === "agotado" ? "moneyRed" : "int"), pct(a.leftPct, "pctRed"),
        c(a.stockAction === "agotado" ? "Agotado" : "Queda poco", "text"), c(a.stockAdd, "intBold")])),
  ];
}
