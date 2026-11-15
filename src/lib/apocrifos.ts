/** Base de facturas apócrifas de ARCA: lectura del archivo público. */
const arDate = (s?: string) => { const m = s?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/); return m ? `${m[3]}-${m[2]}-${m[1]}` : ""; };

/** Lee el archivo de apócrifos (texto con CUIT, fecha de condición y fecha de publicación). */
export function parseApocrifos(text: string) {
  const out: { cuit: string; since: string; published: string }[] = [];
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/)) {
    const cuit = line.match(/\b(\d{2}-?\d{8}-?\d)\b/)?.[1]?.replace(/-/g, "");
    if (!cuit || cuit.length !== 11 || seen.has(cuit)) continue;
    seen.add(cuit);
    const dates = [...line.matchAll(/\b(\d{2}\/\d{2}\/\d{4})\b/g)].map((m) => arDate(m[1]));
    out.push({ cuit, since: dates[0] ?? "", published: dates[1] ?? "" });
  }
  return out;
}

