/**
 * Lector de los listados "Mis Comprobantes" de ARCA (Emitidos / Recibidos).
 * ARCA descarga un ZIP con un CSV adentro (o el CSV suelto). Soporta el formato viejo
 * (Número Desde / Imp. Neto Gravado / IVA) y el nuevo con columnas por alícuota.
 * Corre en el navegador: no sube el archivo, solo las filas ya leídas.
 */
import { unzipSync } from "fflate";

export type Direction = "emitido" | "recibido";
export type VoucherRow = {
  issue_date: string; voucher_type: number; point_of_sale: number; number: string; cae: string;
  doc_type: string; doc_number: string; name: string; currency: string; exchange_rate: number;
  net_taxed: number; net_untaxed: number; exempt: number; other_taxes: number; vat: number; total: number;
  vat_detail: Record<string, { neto: number; iva: number }>;
};
export type ParsedFile = { file: string; direction: Direction; rows: VoucherRow[] };

const norm = (s: string) => s.normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/^﻿/, "").toLowerCase().replace(/\s+/g, " ").trim();

/** "1.234,56" · "1234,56" · "1234.56" · "-12" → número */
export function arNumber(v: string | undefined): number {
  let s = (v ?? "").trim().replace(/[$\s]/g, "");
  if (!s) return 0;
  if (s.includes(",")) s = s.replace(/\./g, "").replace(",", ".");
  const n = Number(s);
  return Number.isFinite(n) ? n : 0;
}

/** "05/11/2026" · "2026-11-05" → "2026-11-05" */
export function arDate(v: string | undefined): string {
  const s = (v ?? "").trim();
  let m = s.match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = s.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  return m ? `${m[3]}-${m[2].padStart(2, "0")}-${m[1].padStart(2, "0")}` : "";
}

/** CSV con ; o , y comillas. */
export function parseCsv(text: string): string[][] {
  const first = text.split(/\r?\n/, 1)[0] ?? "";
  const sep = (first.match(/;/g)?.length ?? 0) >= (first.match(/,/g)?.length ?? 0) ? ";" : ",";
  const out: string[][] = [];
  let row: string[] = [], cell = "", q = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (q) {
      if (c === '"') { if (text[i + 1] === '"') { cell += '"'; i++; } else q = false; } else cell += c;
    } else if (c === '"') q = true;
    else if (c === sep) { row.push(cell); cell = ""; }
    else if (c === "\n" || c === "\r") {
      if (c === "\r" && text[i + 1] === "\n") i++;
      row.push(cell); cell = "";
      if (row.some((x) => x.trim())) out.push(row);
      row = [];
    } else cell += c;
  }
  row.push(cell);
  if (row.some((x) => x.trim())) out.push(row);
  return out;
}

const decode = (b: Uint8Array) => {
  try { return new TextDecoder("utf-8", { fatal: true }).decode(b); } catch { return new TextDecoder("windows-1252").decode(b); }
};

/** Convierte las filas del CSV en comprobantes. Detecta Emitidos/Recibidos por las columnas o el nombre. */
export function parseComprobantes(text: string, fileName = ""): ParsedFile {
  const table = parseCsv(text);
  const hi = table.findIndex((r) => r.some((c) => norm(c).startsWith("fecha")) && r.some((c) => norm(c).includes("tipo")));
  if (hi < 0) throw new Error(`${fileName || "El archivo"} no parece un listado de Mis Comprobantes`);
  const head = table[hi].map(norm);
  const col = (...tests: ((h: string) => boolean)[]) => {
    for (const t of tests) { const i = head.findIndex(t); if (i >= 0) return i; }
    return -1;
  };
  const has = (s: string) => (h: string) => h.includes(s);
  const eq = (s: string) => (h: string) => h === s;

  // Recibidos traen "Denominación Emisor" (y también columnas del receptor, que somos nosotros): manda la denominación
  const side = head.some((h) => h.includes("denominacion") && h.includes("emisor")) ? "emisor"
    : head.some((h) => h.includes("denominacion") && h.includes("receptor")) ? "receptor"
    : head.some((h) => h.includes("emisor")) ? "emisor" : head.some((h) => h.includes("receptor")) ? "receptor" : "";
  const fname = norm(fileName);
  const direction: Direction = side === "receptor" ? "emitido" : side === "emisor" ? "recibido"
    : fname.includes("recibid") ? "recibido" : "emitido";

  const iFecha = col((h) => h.startsWith("fecha"));
  const iTipo = col(eq("tipo de comprobante"), eq("tipo"), (h) => h.startsWith("tipo") && h.includes("comprobante"));
  const iPv = col(has("punto de venta"));
  const iNum = col(has("numero desde"), eq("numero"), (h) => h.startsWith("numero") && !h.includes("hasta"), has("nro. comprobante"));
  const iCae = col(has("autorizacion"), has("cae"));
  const iDocT = col((h) => h.startsWith("tipo doc"));
  const iDocN = col((h) => h.startsWith("nro. doc") || h.startsWith("nro doc") || h.startsWith("numero doc"));
  const iName = col(has("denominacion"));
  const iTc = col(has("tipo cambio"), has("tipo de cambio"));
  const iMon = col(eq("moneda"));
  const iNeto = col(eq("imp. neto gravado"), has("neto gravado total"), eq("neto gravado"));
  const iNoGrav = col(has("neto no gravado"));
  const iExe = col(has("exent"));
  const iOtros = col(has("otros tributos"));
  const iIva = col(eq("iva"), eq("total iva"), eq("imp. iva"));
  const iTotal = col(eq("imp. total"), eq("importe total"), eq("total"));
  if (iFecha < 0 || iTipo < 0 || iNum < 0 || iTotal < 0) throw new Error(`${fileName || "El archivo"}: faltan columnas de fecha, tipo, número o total`);

  // Formato nuevo: "Imp. Neto Gravado IVA 21%" + "IVA 21%"
  const rates = new Map<string, { neto: number; iva: number }>();
  head.forEach((h, i) => {
    const m = h.match(/(\d+(?:[.,]\d+)?)\s*%/);
    if (!m) return;
    const k = m[1].replace(",", ".");
    const e = rates.get(k) ?? { neto: -1, iva: -1 };
    if (h.includes("neto")) e.neto = i; else if (h.includes("iva")) e.iva = i;
    rates.set(k, e);
  });

  const at = (r: string[], i: number) => (i >= 0 ? (r[i] ?? "").trim() : "");
  const rows: VoucherRow[] = [];
  for (const r of table.slice(hi + 1)) {
    const issue = arDate(at(r, iFecha));
    const num = at(r, iNum).replace(/\D/g, "");
    const tipo = parseInt(at(r, iTipo), 10);
    if (!issue || !num || !Number.isFinite(tipo)) continue;
    const abs = (i: number) => Math.abs(arNumber(at(r, i)));
    const detail: VoucherRow["vat_detail"] = {};
    let netSum = 0, vatSum = 0;
    for (const [k, e] of rates) {
      const neto = e.neto >= 0 ? abs(e.neto) : 0, iva = e.iva >= 0 ? abs(e.iva) : 0;
      if (neto || iva) { detail[k] = { neto, iva }; netSum += neto; vatSum += iva; }
    }
    rows.push({
      issue_date: issue, voucher_type: tipo, point_of_sale: parseInt(at(r, iPv), 10) || 0, number: num.replace(/^0+(?=\d)/, ""),
      cae: at(r, iCae).replace(/\D/g, ""), doc_type: at(r, iDocT), doc_number: at(r, iDocN).replace(/\D/g, ""), name: at(r, iName),
      currency: (at(r, iMon) || "ARS").replace(/^\$$/, "ARS").replace(/^PES$/, "ARS"), exchange_rate: arNumber(at(r, iTc)) || 1,
      net_taxed: iNeto >= 0 ? abs(iNeto) : netSum, net_untaxed: abs(iNoGrav), exempt: abs(iExe), other_taxes: abs(iOtros),
      vat: iIva >= 0 ? abs(iIva) : vatSum, total: abs(iTotal), vat_detail: detail,
    });
  }
  return { file: fileName, direction, rows };
}

/** Lee un ZIP de ARCA (uno o varios CSV adentro) o un CSV suelto. */
export async function readComprobantesFile(file: File): Promise<ParsedFile[]> {
  const buf = new Uint8Array(await file.arrayBuffer());
  const isZip = buf[0] === 0x50 && buf[1] === 0x4b;
  if (!isZip) return [parseComprobantes(decode(buf), file.name)];
  const entries = Object.entries(unzipSync(buf)).filter(([n]) => /\.(csv|txt)$/i.test(n));
  if (!entries.length) throw new Error(`${file.name}: el ZIP no tiene un CSV adentro. En ARCA descargalo como CSV.`);
  // Si el CSV adentro no dice el sentido, usamos el nombre del ZIP
  return entries.map(([n, b]) => parseComprobantes(decode(b), /emitid|recibid/i.test(n) ? n : `${file.name} ${n}`));
}
