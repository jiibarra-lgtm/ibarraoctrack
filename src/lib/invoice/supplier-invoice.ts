/**
 * Lector de facturas de proveedores en PDF (cualquier formato: AFIP, sistemas propios, autoimpresores).
 * Trabaja sobre los renglones reconstruidos por posición (pdfLines).
 *
 * Un renglón de producto se reconoce porque cantidad × precio × (descuentos) da el importe.
 * El "precio final" reparte el total pagado (con IVA y percepciones) entre los productos.
 */

export type SupplierItem = {
  line: number;
  code: string | null;
  description: string;
  detail: string | null;
  quantity: number;
  unit: string | null;
  list_price: number | null; // precio de lista del renglón
  discount_pct: number | null;
  pack: number | null; // unidades por bulto cuando el precio es por unidad y la cantidad por caja
  line_net: number;
  unit_net: number; // neto por unidad (después de descuentos)
  unit_final: number | null; // con IVA y percepciones
  vat_rate: number | null;
};

export type SupplierInvoice = {
  kind: "factura" | "nota_credito" | "nota_debito";
  letter: "A" | "B" | "C" | "M" | null;
  point_of_sale: number | null;
  number: number | null;
  issue_date: string | null; // AAAA-MM-DD
  cuits: string[]; // CUIT encontrados, el del emisor primero si se pudo saber
  issuer_cuit: string | null;
  cae: string | null;
  net: number | null;
  total: number | null;
  items_net: number;
  factor: number | null; // total / suma de renglones
  quality: "ok" | "revisar" | "sin_items";
  items: SupplierItem[];
};

const UNIT_WORDS = /^(u|un|uni|unid|unidad|unidades|uds?|caj|caja|cajas|cja|box|bx|kg|kgs|gr|grs|lt|lts|l|ml|mt|mts|m|m2|pack|pk|paq|bolsa|bolsas|rollo|rollos|par|pares|doc|docena|bul|bulto|bultos|fdo|fardo|pza|pzas|ud|bid|bidon|x)\.?$/i;
const EXCLUDE = /sub\s*-?\s*total|\btotal\b|\bneto\b|\bi\.?\s?v\.?\s?a\b|percep|bonif(?:icaci[oó]n)?\s+\d|c\.?\s?a\.?\s?e\b|\bcbu\b|son\s+pesos|\bsaldo\b|pago\s+a\s+imputar|\bdeuda\b|ingresos\s+brutos|impuesto|tributo|vencimiento|cuit|pesos:|cotizaci[oó]n|transparencia\s+fiscal/i;
const HEADER_WORDS = /\b(cant(?:idad)?\.?|descrip(?:ci[oó]n)?|detalle|producto|precio|p\.\s?unit|importe|art[ií]culo|c[oó]digo|unidades|u\.\s?medida|bonif)\b/gi;
const END = /^\s*(sub\s*-?\s*total|neto\s+gravado|importe\s+neto|son\s+pesos|total\b|observaciones|comprobantes\s+relacionados|importe\s+otros)/i;

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

/** Número con formato argentino o inglés ("1.234,56", "1,234.56", "1234,56", "7,995.000"). */
export function parseNum(raw: string): number | null {
  let s = raw.replace(/[$\s]/g, "");
  const neg = /^-/.test(s) || /^\(.*\)$/.test(s);
  s = s.replace(/^[-(]|\)$/g, "");
  if (!/^\d[\d.,]*$/.test(s) || /[.,]{2}/.test(s)) return null;
  const lastDot = s.lastIndexOf("."), lastComma = s.lastIndexOf(",");
  let v: number;
  if (lastDot >= 0 && lastComma >= 0) {
    const dec = lastDot > lastComma ? "." : ",";
    const th = dec === "." ? "," : ".";
    v = Number(s.split(th).join("").replace(dec, "."));
  } else if (lastDot >= 0 || lastComma >= 0) {
    const sep = lastDot >= 0 ? "." : ",";
    const parts = s.split(sep);
    // un solo separador con 3 dígitos atrás = miles ("7.995"); si no, decimales
    if (parts.length > 2 || (parts[1].length === 3 && parts[0].length <= 3 && parts.length === 2 && sep === ".")) v = Number(parts.join(""));
    else if (parts.length === 2) v = Number(parts[0] + "." + parts[1]);
    else v = Number(parts.join(""));
  } else v = Number(s);
  return Number.isFinite(v) ? (neg ? -v : v) : null;
}

const isMoney = (raw: string) => /\d[.,]\d{2,4}$/.test(raw.replace(/[$\s)]/g, ""));

function cuitOk(d: string) {
  if (!/^(20|23|24|27|30|33|34)\d{9}$/.test(d)) return false;
  const w = [5, 4, 3, 2, 7, 6, 5, 4, 3, 2];
  const s = w.reduce((a, x, i) => a + x * Number(d[i]), 0);
  let dv = 11 - (s % 11);
  if (dv === 11) dv = 0;
  if (dv === 10) dv = 9;
  return dv === Number(d[10]);
}

function isoDate(d: string, m: string, y: string) {
  const yy = y.length === 2 ? `20${y}` : y;
  const dd = Number(d), mm = Number(m);
  if (dd < 1 || dd > 31 || mm < 1 || mm > 12) return null;
  return `${yy}-${String(mm).padStart(2, "0")}-${String(dd).padStart(2, "0")}`;
}

type Tok = { raw: string; v: number | null; kind: "num" | "word" | "pct" | "code" | "unit"; i: number };

function tokenize(line: string): Tok[] {
  const words = line.replace(/\$\s+/g, "$").split(/\s+/).filter(Boolean);
  const toks: Tok[] = [];
  for (const w0 of words) {
    let w = w0.replace(/^\$/, "");
    if (w === "%" && toks.length && toks[toks.length - 1].kind === "num") { toks[toks.length - 1].kind = "pct"; continue; }
    // "250.00CAJ" → número + unidad
    const nu = /^(\d[\d.,]*\d|\d)([A-Za-z]{1,8}\.?)$/.exec(w);
    if (nu && UNIT_WORDS.test(nu[2])) {
      toks.push({ raw: nu[1], v: parseNum(nu[1]), kind: "num", i: toks.length });
      toks.push({ raw: nu[2], v: null, kind: "unit", i: toks.length });
      continue;
    }
    const pct = /^(\d[\d.,]*)%$/.exec(w);
    if (pct) { toks.push({ raw: pct[1], v: parseNum(pct[1]), kind: "pct", i: toks.length }); continue; }
    w = w.replace(/[;:]$/, "");
    const v = /^-?\(?\d[\d.,]*\)?$/.test(w) ? parseNum(w) : null;
    if (v !== null) {
      const digits = w.replace(/\D/g, "");
      const plainInt = /^\d+$/.test(w);
      const code = plainInt && ((w.length >= 4 && w.startsWith("0")) || digits.length >= 6);
      toks.push({ raw: w, v, kind: code ? "code" : "num", i: toks.length });
    } else toks.push({ raw: w0, v: null, kind: "word", i: toks.length });
  }
  // unidades pegadas a la cantidad
  for (let k = 1; k < toks.length; k++)
    if (toks[k].kind === "word" && toks[k - 1].kind === "num" && UNIT_WORDS.test(toks[k].raw)) toks[k].kind = "unit";
  return toks;
}

const letters = (s: string) => (s.match(/[A-Za-zÁÉÍÓÚÑáéíóúñ]/g) ?? []).length;

type Found = { q: Tok; p: Tok; t: Tok; discounts: number[]; pack: number };

/** Busca cantidad, precio e importe que cierren: q × p × Π(1 − d) ≈ importe (o × unidades por bulto). */
function explain(nums: Tok[]): Found | null {
  const byValue = nums.filter((n) => n.v !== null && n.v > 0).sort((a, b) => (b.v as number) - (a.v as number));
  const close = (a: number, b: number, tol = 0.003) => Math.abs(a - b) <= Math.max(1, Math.abs(b) * tol);
  for (const pass of ["exact", "pack"] as const) {
    for (const t of byValue) {
      if (!isMoney(t.raw) && (t.v as number) < 1000) continue;
      let best: Found | null = null;
      for (const q of nums) {
        if (q.i >= t.i || !q.v || q.v <= 0 || q.v > 1e6) continue;
        for (const p of nums) {
          if (p === q || p === t || p.i >= t.i || !p.v || p.v <= 0) continue;
          if (pass === "pack" && (q.i > p.i || !Number.isInteger(q.v))) continue;
          const between = nums.filter((n) => n.i > p.i && n.i < t.i && n.v !== null && (n.v as number) >= 0 && (n.v as number) < 100);
          const sets: number[][] = [[]];
          for (let k = 1; k <= Math.min(between.length, 4); k++) sets.push(between.slice(0, k).map((n) => n.v as number));
          for (const ds of sets) {
            const base = q.v * p.v * ds.reduce((a, d) => a * (1 - d / 100), 1);
            if (base <= 0) continue;
            let pack = 1;
            if (pass === "exact") { if (!close(base, t.v as number)) continue; }
            else {
              pack = Math.round((t.v as number) / base);
              if (pack < 2 || pack > 500 || Math.abs(base * pack - (t.v as number)) > Math.max(1, (t.v as number) * 0.0002)) continue;
            }
            const cand = { q, p, t, discounts: ds.filter((d) => d > 0), pack };
            const err = (c: Found) => Math.abs(c.q.v! * c.p.v! * c.discounts.reduce((a, d) => a * (1 - d / 100), 1) * c.pack - (c.t.v as number));
            // preferimos que la cantidad venga antes que el precio, y la cuenta más exacta
            if (!best || (best.q.i > best.p.i && q.i < p.i) || (pass === "pack" && err(cand) < err(best))) best = cand;
          }
        }
      }
      if (best) return best;
    }
  }
  return null;
}

/** Renglones de una sola hoja, sin copias (ORIGINAL / DUPLICADO / TRIPLICADO). */
function uniquePages(pages: string[][]) {
  const first = new Set(pages[0] ?? []);
  const out = [...(pages[0] ?? [])];
  for (const pg of pages.slice(1)) {
    const same = pg.filter((l) => first.has(l)).length;
    if (pg.length && same / pg.length > 0.6) continue;
    out.push(...pg);
  }
  return out;
}

export function parseSupplierInvoice(pages: string[][], hints: { ownCuit?: string | null; subject?: string; filename?: string } = {}): SupplierInvoice {
  const lines = uniquePages(pages);
  const flat = lines.join("\n");
  const own = (hints.ownCuit ?? "").replace(/\D/g, "");

  // Clase de comprobante
  // el título del comprobante, no la letra chica ("se emitirá una nota de débito por…")
  const head = lines.slice(0, 14).filter((l) => l.trim().length <= 48).join("\n");
  const kind: SupplierInvoice["kind"] = /^\s*(?:[ABC]\s+)?nota\s+de\s+cr[eé]dito|\bN\.?\s?C\.?\s?[ABC]?\s*\d{4,5}-/im.test(head) ? "nota_credito"
    : /^\s*(?:[ABC]\s+)?nota\s+de\s+d[eé]bito|\bN\.?\s?D\.?\s?[ABC]?\s*\d{4,5}-/im.test(head) ? "nota_debito" : "factura";

  // Código de barras / QR en texto: CUIT(11) + tipo(3) + PV(4-5) + CAE(14) + vto(8)
  let barcode: { cuit: string; type: number; pv: number; cae: string } | null = null;
  for (const m of flat.matchAll(/\b(\d{11})(\d{3})(\d{5})(\d{14})(\d{8})\d?\b/g))
    if (cuitOk(m[1])) { barcode = { cuit: m[1], type: Number(m[2]), pv: Number(m[3]), cae: m[4] }; break; }

  let letter: SupplierInvoice["letter"] = null;
  const lm = /\bFACTURA\s+([ABCM])\b|\b([ABCM])\s+F\s?A\s?C\s?T\s?U\s?R\s?A\b|\bFAC(?:T\.?)?\s*([ABCM])\b|\bF\s?C\s?([ABCM])\s?\d{4}|^\s*([ABCM])(?:\s{2,}|\s*$)|^\s*([ABCM])\d{4,5}-\d{8}/im.exec(flat);
  if (lm) letter = (lm.slice(1).find(Boolean) ?? "").toUpperCase() as SupplierInvoice["letter"];
  if (!letter) {
    const cod = /C[oó]d(?:igo)?\.?\s*(?:N[°º]\.?\s*)?0*(1|6|11|51|3|8|13)\b/i.exec(flat)?.[1] ?? (barcode ? String(barcode.type) : "");
    letter = ({ "1": "A", "3": "A", "6": "B", "8": "B", "11": "C", "13": "C", "51": "M" } as Record<string, SupplierInvoice["letter"]>)[cod] ?? null;
  }

  // Punto de venta y número
  let pv: number | null = null, num: number | null = null;
  const pvn = /Punto\s+de\s+Venta:?\s*(\d{1,5})[\s\S]{0,40}?Comp(?:robante)?\.?\s*(?:Nro|N[°º])\.?:?\s*(\d{1,8})/i.exec(flat);
  if (pvn) { pv = Number(pvn[1]); num = Number(pvn[2]); }
  if (num === null) {
    const m = /\bF\s?[CA]\s?[ABCM]?\s?(\d{5})(\d{8})\b/i.exec(flat) ?? /\bFACTURA\s+(\d{4,5})\s+(\d{8})\b/i.exec(flat);
    if (m) { pv = Number(m[1]); num = Number(m[2]); }
  }
  if (num === null) {
    for (const l of lines) {
      if (/remito|\brto\b|\bre\b|pedido|relacionad|presupuesto|\bn\.?\s?p\b|orden/i.test(l)) {
        const head = /^\s*[ABCM]?\s*(\d{4,5})\s*-\s*(\d{8})\b/.exec(l); // a veces el número de factura va primero en la misma línea
        if (!head) continue;
      }
      const m = /(?:^|[^\d-])[ABCM]?\s?(\d{4,5})\s*-\s*(\d{8})(?!\d)/.exec(l);
      if (m) { pv = Number(m[1]); num = Number(m[2]); break; }
    }
  }
  if (num === null) {
    for (const h of [hints.filename ?? "", hints.subject ?? ""]) {
      const m = /F\s?[AC]?\s?[ABCM]?\s?(\d{4,5})[-\s]?(\d{8})/i.exec(h) ?? /\b(\d{4,5})\s*-\s*(\d{8})\b/.exec(h);
      if (m) { pv = Number(m[1]); num = Number(m[2]); break; }
    }
  }
  if (pv === null && barcode) pv = barcode.pv;

  // Fecha de emisión
  let issue_date: string | null = null;
  const dateLines = lines.filter((l) => /\d{1,2}\/\d{1,2}\/\d{2,4}/.test(l));
  const skipDate = /inicio|activ|vto|venc|desde|hasta|imputar|pagar|pago|cae|nacim/i;
  const prefer = dateLines.find((l) => /emisi[oó]n|fecha/i.test(l) && !/inicio|vto|venc/i.test(l.slice(0, l.search(/\d{1,2}\/\d{1,2}\/\d{2,4}/))));
  for (const l of [prefer, ...dateLines].filter(Boolean) as string[]) {
    const re = /(\d{1,2})\/(\d{1,2})\/(\d{4}|\d{2})\b/g;
    let m: RegExpExecArray | null;
    while ((m = re.exec(l))) {
      const before = l.slice(Math.max(0, m.index - 28), m.index);
      if (skipDate.test(before) && !/emisi[oó]n/i.test(before)) continue;
      issue_date = isoDate(m[1], m[2], m[3]);
      if (issue_date) break;
    }
    if (issue_date) break;
  }

  // CUIT: emisor primero
  const found: string[] = [];
  for (const m of flat.matchAll(/(?<!\d)(\d{2})\s?-?\s?(\d{8})\s?-?\s?(\d)(?!\d)/g)) {
    const d = m[1] + m[2] + m[3];
    if (cuitOk(d) && !found.includes(d)) found.push(d);
  }
  if (barcode && !found.includes(barcode.cuit)) found.unshift(barcode.cuit);
  const issuer = barcode?.cuit ?? found.find((c) => c !== own) ?? null;
  const cuits = issuer ? [issuer, ...found.filter((c) => c !== issuer)] : found;

  const cae = /C\.?\s?A\.?\s?E\.?[^\d\n]{0,25}(\d{14})/i.exec(flat)?.[1] ?? barcode?.cae ?? null;

  // Totales: el mayor importe con decimales del comprobante
  let total: number | null = null;
  for (const l of lines) {
    if (/\bcbu\b|cuenta|deuda\s+total\s+en/i.test(l)) continue;
    for (const t of tokenize(l)) if ((t.kind === "num" || t.kind === "pct") && t.v !== null && isMoney(t.raw) && t.kind === "num") total = Math.max(total ?? 0, Math.abs(t.v));
  }
  let net: number | null = null;
  lines.forEach((l, i) => {
    if (!/neto|sub\s*-?\s*total/i.test(l)) return;
    const vals = [l, /\d[.,]\d{2}/.test(l) ? "" : lines[i + 1] ?? ""].flatMap((x) => tokenize(x)).filter((t) => t.kind === "num" && isMoney(t.raw)).map((t) => t.v as number);
    if (vals.length) net = Math.max(net ?? 0, ...vals);
  });

  // Zona de renglones: después del encabezado de columnas, hasta subtotal / total
  let start = 0, end = lines.length;
  const hi = lines.findIndex((l) => new Set((l.match(HEADER_WORDS) ?? []).map((w) => w.toLowerCase().slice(0, 4))).size >= 2 && !/\d[.,]\d{2}/.test(l));
  if (hi >= 0) {
    start = hi + 1;
    const e = lines.findIndex((l, i) => i > hi && END.test(l));
    if (e > 0) end = e;
  }

  const items: SupplierItem[] = [];
  let last: SupplierItem | null = null;
  for (let i = start; i < end; i++) {
    const l = lines[i];
    if (!l.trim()) continue;
    if (EXCLUDE.test(l)) { last = null; continue; }
    const toks = tokenize(l);
    const wordIdx = toks.filter((t) => t.kind === "word" && letters(t.raw) >= 1).map((t) => t.i);
    if (!wordIdx.length) continue;
    const d0 = wordIdx[0], d1 = wordIdx[wordIdx.length - 1];
    const descToks = toks.slice(d0, d1 + 1);
    const nums = toks.filter((t) => (t.kind === "num" || t.kind === "pct") && (t.i < d0 || t.i > d1));
    const f = nums.length >= 2 ? explain(nums.map((t) => ({ ...t, kind: t.kind === "pct" ? "num" : t.kind })) as Tok[]) : null;
    if (!f) {
      // continuación de la descripción del renglón anterior (sólo dentro de la tabla)
      if (hi >= 0 && last && !/:/.test(l) && !nums.some((n) => isMoney(n.raw)) && letters(l) >= 4) last.detail = `${last.detail ? last.detail + " " : ""}${l.trim().replace(/\s{2,}/g, " ")}`.slice(0, 400);
      else last = null;
      continue;
    }
    // números sueltos entre la descripción y la cantidad/precio (ej. "930" ml) son parte del nombre
    const firstUsed = Math.min(f.q.i, f.p.i);
    const tail = firstUsed > d1 ? toks.slice(d1 + 1, firstUsed).filter((t) => t.kind !== "unit" && t !== f.q && t !== f.p) : [];
    descToks.push(...tail);
    let description = descToks.map((t) => t.raw).join(" ").replace(/\s{2,}/g, " ").trim();
    let code = toks.find((t) => t.kind === "code" && t.i < d0)?.raw ?? null;
    const lead = /^([\d/.\-]{3,})([A-ZÁÉÍÓÚÑ].*)$/.exec(description); // "0402805/1500TOALLAS"
    if (lead) { code = code ?? lead[1]; description = lead[2]; }
    const parts = description.split(" ");
    if (parts.length >= 3 && /^(?=.*\d)(?=.*[A-Z])[A-Z0-9/.\-]{4,14}$/.test(parts[0])) { code = code ?? parts[0]; description = parts.slice(1).join(" "); }
    if (letters(description) < 3) continue;
    const unit = toks.find((t) => t.kind === "unit" && (t.i < d0 || t.i > d1))?.raw.replace(/\.$/, "") ?? null;
    const qty = f.q.v as number;
    const lineNet = f.t.v as number;
    const vat = toks.filter((t) => t.i > f.t.i && t.v !== null && [21, 10.5, 27, 0, 5, 2.5].includes(t.v)).map((t) => t.v as number)[0] ?? null;
    const discount = f.discounts.length ? r2((1 - f.discounts.reduce((a, d) => a * (1 - d / 100), 1)) * 100) : null;
    last = {
      line: items.length + 1, code, description: description.slice(0, 300), detail: null, quantity: qty, unit,
      list_price: f.p.v as number, discount_pct: discount, pack: f.pack > 1 ? f.pack : null,
      line_net: r2(lineNet), unit_net: r4(lineNet / qty), unit_final: null, vat_rate: vat,
    };
    items.push(last);
  }

  const items_net = r2(items.reduce((a, it) => a + it.line_net, 0));
  let factor: number | null = null;
  if (items.length && total) {
    const k = total / items_net;
    if (k >= 0.85 && k <= 1.5) factor = r4(k);
  }
  for (const it of items) if (factor) it.unit_final = r2((it.line_net * factor) / it.quantity);

  const quality: SupplierInvoice["quality"] = !items.length ? "sin_items" : factor && (!net || Math.abs(items_net - net) <= Math.max(2, net * 0.03) || factor <= 1.35) ? "ok" : "revisar";

  return {
    kind, letter, point_of_sale: pv, number: num, issue_date, cuits, issuer_cuit: issuer && issuer !== own ? issuer : null, cae,
    net, total, items_net, factor, quality, items,
  };
}
