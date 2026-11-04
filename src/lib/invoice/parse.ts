import { parseArNumber, lineTotal, differs, sum, dec } from "@/lib/money";
import { parseArDate } from "@/lib/format";

/**
 * Lector de facturas de proveedores (formato de comprobante electrónico AFIP/ARCA).
 * Funciona sobre texto de PDF o de OCR. Lo que no se reconoce queda vacío y en revisión.
 */
export type InvoiceItem = {
  description: string;
  quantity: string;
  unit: string;
  unit_price: string;
  discount_pct: string;
  vat_rate: string;
  net_amount: string;
};

export type InvoiceDraft = {
  supplier_name: string;
  supplier_cuit: string;
  doc_type: "factura_a" | "factura_b" | "factura_c" | "factura_m" | "ticket" | "remito" | "otro";
  point_of_sale: string;
  number: string;
  invoice_date: string;
  due_date: string;
  net_amount: string;
  vat_amount: string;
  other_taxes: string;
  total_amount: string;
  cae: string;
  items: InvoiceItem[];
};

export type InvoiceExtraction = { draft: InvoiceDraft; review: string[]; warnings: string[] };

const NUM = /(?<![\w.,])-?\d{1,3}(?:\.\d{3})*,\d{1,4}(?![\d])|(?<![\w.,])-?\d+[.,]\d{2,4}(?![\d.,]\d)|(?<![\w.,/-])\d+(?![\w.,/-])/g;

function amountAfter(text: string, labels: RegExp): string {
  const m = labels.exec(text);
  if (!m) return "";
  const rest = text.slice(m.index + m[0].length, m.index + m[0].length + 60);
  const n = /\$?\s*(-?\d[\d.,]*\d)/.exec(rest);
  return n ? parseArNumber(n[1]) ?? "" : "";
}

const fmtCuit = (d: string) => `${d.slice(0, 2)}-${d.slice(2, 10)}-${d.slice(10)}`;

export function parseInvoiceText(raw: string, ownCuit?: string | null): InvoiceExtraction {
  const text = raw.replace(/\r/g, "").replace(/ /g, " ");
  const flat = text.replace(/\s+/g, " ");
  const review: string[] = [];
  const warnings: string[] = [];
  const own = (ownCuit ?? "").replace(/\D/g, "");

  // Tipo de comprobante
  const letter = /\b(?:FACTURA|FACT\.?)\s*([ABCM])\b|\b([ABCM])\s*(?:C[oó]d\.?|COD\.?)\s*0?(?:01|06|11|51)\b|^\s*([ABCM])\s*$/im.exec(text);
  const L = (letter?.[1] || letter?.[2] || letter?.[3] || "").toUpperCase();
  let doc_type: InvoiceDraft["doc_type"] = L ? (`factura_${L.toLowerCase()}` as InvoiceDraft["doc_type"]) : "otro";
  if (!L && /\bremito\b/i.test(flat)) doc_type = "remito";
  if (!L && /\bticket\b/i.test(flat)) doc_type = "ticket";
  if (doc_type === "otro" && /factura/i.test(flat)) doc_type = "factura_a";

  // Número: "Punto de Venta: 00002 Comp. Nro: 00000123" o "0002-00000123"
  let pos = "", num = "";
  const pv = /Punto\s+de\s+Venta:?\s*(\d{1,5})/i.exec(flat);
  const cn = /Comp\.?\s*(?:Nro|N[°º])\.?:?\s*(\d{1,8})/i.exec(flat);
  if (pv && cn) { pos = pv[1]; num = cn[1]; }
  else {
    const m = /\b(\d{4,5})\s*-\s*(\d{8})\b/.exec(flat);
    if (m) { pos = m[1]; num = m[2]; }
  }
  if (pos) pos = pos.padStart(5, "0");
  if (num) num = num.padStart(8, "0");

  // Fechas
  const fe = /Fecha\s+(?:de\s+)?Emisi[oó]n:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(flat) ?? /\bFecha:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(flat);
  const invoice_date = fe ? parseArDate(fe[1]) ?? "" : "";
  const fv = /(?:Fecha\s+de\s+)?Vto\.?\s+(?:para\s+el\s+)?pago:?\s*(\d{1,2}\/\d{1,2}\/\d{4})/i.exec(flat);
  const due_date = fv ? parseArDate(fv[1]) ?? "" : "";

  // Emisor: primer CUIT que no sea el nuestro
  const cuits = [...flat.matchAll(/\b(\d{2})-?(\d{8})-?(\d)\b/g)].map((m) => m[1] + m[2] + m[3]);
  const supplierCuit = cuits.find((c) => c !== own) ?? "";
  const rs = /Raz[oó]n\s+Social:?\s*([^\n]+?)(?=\s{2,}|\s+Fecha|\s+Domicilio|\s+CUIT|\n|$)/i.exec(text);
  let supplier_name = rs ? rs[1].trim() : "";
  if (!supplier_name) {
    const first = text.split("\n").map((l) => l.trim()).find((l) => /[A-Z]{3,}/.test(l) && !/ORIGINAL|DUPLICADO|FACTURA|^[ABCM]$/i.test(l));
    supplier_name = first?.slice(0, 120) ?? "";
    if (supplier_name) review.push("supplier_name");
  }

  // Totales
  const net_amount = amountAfter(flat, /Importe\s+Neto\s+Gravado:?|Neto\s+Gravado:?|Subtotal:/i);
  const vat21 = amountAfter(flat, /IVA\s*21\s*%:?/i);
  const vat105 = amountAfter(flat, /IVA\s*10[.,]5\s*%:?/i);
  const vat27 = amountAfter(flat, /IVA\s*27\s*%:?/i);
  const vat_amount = sum([vat21, vat105, vat27].filter(Boolean));
  const otherTaxes = amountAfter(flat, /Importe\s+Otros\s+Tributos:?|Percepci[oó]n(?:es)?\s+(?:IIBB|Ingresos\s+Brutos)?:?/i);
  const total_amount = amountAfter(flat, /Importe\s+Total:?|\bTOTAL:?/i);
  const cae = /CAE\s*N?[°º]?:?\s*(\d{14})/i.exec(flat)?.[1] ?? "";

  // Renglones: líneas con cantidad, precio y subtotal que cierran
  const items: InvoiceItem[] = [];
  const lines = text.split("\n");
  for (const line of lines) {
    if (/Importe|Subtotal:|Neto\s+Gravado|IVA\s*\d|CAE|Punto de Venta|Fecha|CUIT/i.test(line)) continue;
    const nums = [...line.matchAll(NUM)].map((m) => ({ raw: m[0], at: m.index ?? 0, v: parseArNumber(m[0]) }))
      .filter((n) => n.v !== null) as { raw: string; at: number; v: string }[];
    if (nums.length < 3) continue;
    let found: { q: number; p: number; s: number; b?: number } | null = null;
    outer: for (let a = 0; a < nums.length; a++)
      for (let b = a + 1; b < nums.length; b++)
        for (let c = b + 1; c < nums.length; c++) {
          const q = nums[a].v, p = nums[b].v, s = nums[c].v;
          if (dec(q).lte(0)) continue;
          if (!differs(lineTotal(q, p), s)) { found = { q: a, p: b, s: c }; break outer; }
          // con bonificación entre precio y subtotal
          if (c - b === 2) {
            const disc = nums[b + 1].v;
            if (dec(disc).lt(100) && !differs(dec(lineTotal(q, p)).times(dec(1).minus(dec(disc).div(100))).toDecimalPlaces(2).toFixed(2), s)) {
              found = { q: a, p: b, s: c, b: b + 1 }; break outer;
            }
          }
        }
    if (!found) continue;
    const descEnd = nums[found.q].at;
    let description = line.slice(0, descEnd).replace(/^\s*\d{1,8}\s+/, "").trim();
    const afterQty = line.slice(nums[found.q].at + nums[found.q].raw.length, nums[found.p].at).trim();
    const unit = /^[A-Za-zÁÉÍÓÚáéíóú.]{2,12}$/.test(afterQty) ? afterQty : "";
    if (!description) description = line.slice(nums[found.s].at + nums[found.s].raw.length).trim();
    if (!description) continue;
    const vatAfter = nums.slice(found.s + 1).find((n) => ["21", "10.5", "10,5", "27", "0", "21.00", "10.50", "27.00"].includes(n.raw.replace("%", "")));
    items.push({
      description: description.replace(/\s{2,}/g, " "),
      quantity: nums[found.q].v,
      unit,
      unit_price: nums[found.p].v,
      discount_pct: found.b !== undefined ? nums[found.b].v : "0",
      vat_rate: vatAfter ? (parseArNumber(vatAfter.raw) ?? "21") : (vat105 && !vat21 ? "10.5" : "21"),
      net_amount: nums[found.s].v,
    });
  }

  const draft: InvoiceDraft = {
    supplier_name, supplier_cuit: supplierCuit ? fmtCuit(supplierCuit) : "", doc_type,
    point_of_sale: pos, number: num, invoice_date, due_date,
    net_amount, vat_amount: vat_amount === "0.00" ? "" : vat_amount, other_taxes: otherTaxes, total_amount, cae, items,
  };

  (["supplier_cuit", "number", "invoice_date", "total_amount"] as const).forEach((k) => { if (!draft[k]) review.push(k); });
  if (!items.length) {
    warnings.push("No se pudieron leer los renglones: cargalos o corregilos antes de confirmar.");
    review.push("items");
  } else if (net_amount) {
    const s = sum(items.map((i) => i.net_amount));
    if (differs(s, net_amount, "1")) {
      warnings.push(`La suma de renglones (${s}) no coincide con el neto gravado (${net_amount}).`);
      review.push("items");
    }
  }
  if (net_amount && total_amount) {
    const expected = sum([net_amount, draft.vat_amount || "0", otherTaxes || "0"]);
    if (differs(expected, total_amount, "1")) warnings.push(`Neto + IVA + otros (${expected}) no coincide con el total (${total_amount}).`);
  }
  return { draft, review, warnings };
}
