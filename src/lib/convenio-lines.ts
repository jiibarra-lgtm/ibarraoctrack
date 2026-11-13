/**
 * "Líneas del Convenio Marco" (reporte del BAC): una fila por oferta (proveedor) de cada renglón.
 * Se agrupa por renglón + opción: tu oferta (por tu CUIT), el mejor precio de los demás y cuántos ofertan.
 */
export type ConvenioLine = {
  line: number; option: number; code: string | null; description: string; unit: string | null; name: string; spec: string | null;
  mine: boolean; offer_price: number | null; current_price: number | null; stock_balance: number | null; stock: number | null; best_other: number | null; offers: number;
};

const H = {
  line: /n[uú]mero de l[ií]nea/i, option: /n[uú]mero de opci[oó]n/i, code: /c[oó]digo de [ií]tem/i, description: /descripci[oó]n de [ií]tem/i, unit: /unidad/i,
  spec: /especificaciones/i, name: /raz[oó]n social/i, cuit: /cuit/i, offer: /precio unitario ofertado/i, current: /precio actual/i, balance: /saldo stock/i, stock: /stock actual/i,
};
const num = (v: unknown) => (v === null || v === undefined || v === "" ? null : Number.isFinite(Number(v)) ? Number(v) : null);
const clean = (s: string) => s.replace(/\s+/g, " ").trim();

/** Nombre corto del producto: tu especificación (sin el copy del pliego) o la descripción del ítem hasta "Nota:/Modelo:" */
export function shortName(description: string, spec: string | null) {
  const desc = clean(description.split(/\s{3,}|\.\s+(?=[A-ZÁÉÍÓÚ][a-záéíóú])/)[0]).split(/\s+(?:Nota:|Dem[aá]s especificaciones|Modelo:|Presentaci[oó]n:|Aplicaci[oó]n:)/i)[0].replace(/[.\s]+$/, "");
  // el nombre del ítem va en mayúsculas y después sigue el texto del pliego: "AGUA LAVANDINA (HIPOCLORITO DE SODIO) Líquido amarillento…"
  const caps: string[] = [];
  for (const t of desc.split(" ")) { if (/[a-záéíóúñ]/.test(t)) break; caps.push(t); }
  const head = caps.join(" ").length >= 4 ? caps.join(" ").replace(/[\s:,-]+$/, "") : desc;
  return finish(head, spec);
}

function finish(desc: string, spec: string | null) {
  if (!spec) return desc.slice(0, 160);
  const s = clean(spec.replace(/^RENGL[OÓ]N \d+:\s*/i, "").replace(/Especificaciones t[eé]cnicas:\s*/i, ""));
  const brand = /marca:?\s+([A-ZÁÉÍÓÚÑ0-9][\wÁÉÍÓÚÑáéíóúñ.&' -]{1,30})/i.exec(s)?.[1]?.trim();
  const pres = /(?:caja|pack|bid[oó]n|botella|envase|bolsa|paquete|frasco|sachet|rollo|x)\s*(?:x|de)?\s*\d[\d.,]*\s*(?:u\.?|un\.?|unidades|envases?|botellas?|paquetes?|rollos?|l|lt|lts|litros?|cc|ml|kg|g|gr|m|mts|metros)\b/i.exec(s)?.[0];
  return [desc, pres, brand ? `marca ${brand.replace(/[.,]+$/, "")}` : null].filter(Boolean).join(" · ").slice(0, 200);
}

export function parseConvenioLines(rows: (string | number | null)[][], ownCuit: string): ConvenioLine[] {
  const hi = rows.findIndex((r) => r.some((c) => typeof c === "string" && H.line.test(c)));
  if (hi < 0) throw new Error("No encontré la columna 'Número de Línea': ¿es el Excel de Líneas del Convenio Marco?");
  const head = rows[hi].map((c) => String(c ?? ""));
  const idx = Object.fromEntries(Object.entries(H).map(([k, re]) => [k, head.findIndex((h) => re.test(h))])) as Record<keyof typeof H, number>;
  // "Unidad de medida" (no "Precio unitario")
  idx.unit = head.findIndex((h) => /^unidad/i.test(h));
  const own = ownCuit.replace(/\D/g, "");
  const groups = new Map<string, (string | number | null)[][]>();
  for (const r of rows.slice(hi + 1)) {
    const line = num(r[idx.line]);
    if (!line) continue;
    const key = `${line}|${num(r[idx.option]) ?? 1}`;
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  return [...groups.entries()].map(([key, rs]) => {
    const [line, option] = key.split("|").map(Number);
    const mineRow = rs.find((r) => String(r[idx.cuit] ?? "").replace(/\D/g, "") === own) ?? null;
    const others = rs.filter((r) => r !== mineRow).map((r) => num(r[idx.current])).filter((x): x is number => x !== null && x > 0);
    const first = rs[0];
    const rawDescription = String(first[idx.description] ?? "");
    const description = clean(rawDescription);
    const spec = mineRow ? String(mineRow[idx.spec] ?? "").trim() || null : null;
    return {
      line, option, code: (first[idx.code] as string | null) ?? null, description, unit: (first[idx.unit] as string | null) ?? null,
      name: shortName(rawDescription, spec), spec, mine: !!mineRow,
      offer_price: mineRow ? num(mineRow[idx.offer]) : null, current_price: mineRow ? num(mineRow[idx.current]) : null,
      stock_balance: mineRow ? num(mineRow[idx.balance]) : null, stock: mineRow ? num(mineRow[idx.stock]) : null,
      best_other: others.length ? Math.min(...others) : null, offers: rs.length,
    };
  }).sort((a, b) => a.line - b.line || a.option - b.option);
}

/** "Lineas_del_Convenio_Marco_623-38-CM26_3.xlsx" → 623-38-CM26 */
export const contractFromFilename = (f: string) => /(\d{2,5}-\d{1,4}-CM\d{2})/i.exec(f)?.[1]?.toUpperCase() ?? null;
