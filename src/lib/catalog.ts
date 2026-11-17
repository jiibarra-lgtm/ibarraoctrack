import type { Cell, StyledSheet } from "@/lib/xlsx-styled";

/** Catálogo de productos armado desde tus renglones de convenio (sin repetir el mismo producto). */
export type CatalogLine = {
  contract_number: string; convenio_name: string | null; line_number: number; item_code: string | null; unit: string | null;
  product_name: string | null; item_description: string | null; my_spec: string | null; my_current_price: string | number | null; my_stock: string | number | null;
};
export type CatalogItem = {
  key: string; name: string; presentation: string | null; brand: string | null; codes: string[]; unit: string | null;
  price: number | null; stock: number | null; spec: string | null; lines: string[];
};
export type CatalogGroup = { rubro: string; items: CatalogItem[] };

const RUBRO: Record<string, string> = {
  "Adquisición de Artículos de Limpieza": "Limpieza",
  "Adquisición de Contenedores": "Contenedores y residuos",
  "Adquisición de Artículos de Tocador y Perfumería": "Tocador y perfumería",
  "Adquisición de Artículos de Bazar": "Bazar",
};
const SMALL = new Set(["de", "del", "la", "las", "el", "los", "y", "x", "con", "para", "en", "por", "a", "o", "sin"]);
const cap = (s: string) => s.toLowerCase().replace(/(^|[\s(/-])([a-záéíóúñ][a-záéíóúñ.]*)/g, (m, a: string, w: string) => (a && SMALL.has(w) ? a + w : a + w[0].toUpperCase() + w.slice(1)));

/** "AGUA LAVANDINA · Bidón x 1 litro · marca DRUCKE" → nombre, presentación y marca. */
export function splitProduct(productName: string | null, description: string | null) {
  const parts = (productName || description || "").split("·").map((x) => x.trim()).filter(Boolean);
  const name = parts[0] ? parts[0].replace(/\s*-\s*AYUDA SOCIAL A PERSONAS\s*\.?/i, "").replace(/\s+/g, " ").trim() : "Producto";
  let brand: string | null = null;
  const rest: string[] = [];
  for (const p of parts.slice(1)) { const m = /^marca\s+(.+)$/i.exec(p); if (m) brand = m[1].trim(); else rest.push(p); }
  return { name: cap(name), presentation: rest.join(" · ") || null, brand: brand ? brand.toUpperCase() : null };
}

export function buildCatalog(lines: CatalogLine[]): CatalogGroup[] {
  const groups = new Map<string, Map<string, CatalogItem>>();
  for (const l of lines) {
    const rubro = RUBRO[l.convenio_name ?? ""] ?? (l.convenio_name ? l.convenio_name.replace(/^Adquisici[oó]n de (Art[ií]culos de )?/i, "") : l.contract_number);
    const { name, presentation, brand } = splitProduct(l.product_name, l.item_description);
    const key = `${name}|${presentation ?? ""}|${brand ?? ""}`.toLowerCase();
    const g = groups.get(rubro) ?? new Map<string, CatalogItem>();
    const price = l.my_current_price != null && Number(l.my_current_price) > 0 ? Number(l.my_current_price) : null;
    const prev = g.get(key);
    if (prev) {
      if (l.item_code && !prev.codes.includes(l.item_code)) prev.codes.push(l.item_code);
      prev.lines.push(`${l.contract_number} R${l.line_number}`);
      if (price != null && (prev.price == null || price < prev.price)) prev.price = price;
    } else {
      g.set(key, {
        key, name, presentation, brand, codes: l.item_code ? [l.item_code] : [], unit: l.unit ? cap(l.unit) : null, price,
        stock: l.my_stock != null ? Number(l.my_stock) : null,
        spec: (l.my_spec ?? "").replace(/\s+/g, " ").trim().slice(0, 400) || null, lines: [`${l.contract_number} R${l.line_number}`],
      });
    }
    groups.set(rubro, g);
  }
  return [...groups].map(([rubro, m]) => ({ rubro, items: [...m.values()].sort((a, b) => a.name.localeCompare(b.name, "es")) }))
    .sort((a, b) => a.rubro.localeCompare(b.rubro, "es"));
}

export type CatalogOptions = { prices: boolean; specs: boolean; title: string; company: { name: string; address?: string; phones?: string; whatsapp?: string; cuit?: string }; date: string };

/** Excel del catálogo: una hoja con todo (agrupado por rubro) y una por rubro. */
export function catalogWorkbook(groups: CatalogGroup[], o: CatalogOptions): StyledSheet[] {
  const head = ["Producto", "Presentación", "Marca", ...(o.specs ? ["Descripción"] : []), "Código GCBA", ...(o.prices ? ["Precio c/IVA"] : [])];
  const widths = [38, 26, 16, ...(o.specs ? [60] : []), 20, ...(o.prices ? [14] : [])];
  const lastCol = String.fromCharCode(64 + head.length);
  const row = (i: CatalogItem): Cell[] => [
    { v: i.name, s: "text" }, { v: i.presentation ?? "", s: "wrap" }, { v: i.brand ?? "", s: "text" },
    ...(o.specs ? [{ v: i.spec ?? "", s: "wrap" as const }] : []),
    { v: i.codes.join(", "), s: "text" },
    ...(o.prices ? [i.price != null ? { v: i.price, s: "money" as const } : { v: "Consultar", s: "missing" as const }] : []),
  ];
  const header = (title: string): Cell[][] => [
    [{ v: title, s: "title" }],
    [{ v: [o.company.name, o.company.address, o.company.phones, o.company.whatsapp ? `WhatsApp ${o.company.whatsapp}` : null, o.company.cuit ? `CUIT ${o.company.cuit}` : null].filter(Boolean).join(" · "), s: "subtitle" }],
    [{ v: `Actualizado el ${o.date.split("-").reverse().join("/")}${o.prices ? " · precios con IVA incluido, sujetos a cambio" : ""}`, s: "subtitle" }],
    [],
  ];
  const all: Cell[][] = [...header(o.title), head.map((h) => ({ v: h, s: "headDark" as const }))];
  const merges = [`A1:${lastCol}1`, `A2:${lastCol}2`, `A3:${lastCol}3`];
  for (const g of groups) {
    all.push([{ v: `${g.rubro} (${g.items.length})`, s: "headBlue" }]);
    merges.push(`A${all.length}:${lastCol}${all.length}`);
    for (const i of g.items) all.push(row(i));
  }
  const sheets: StyledSheet[] = [{ name: "Catálogo", rows: all, widths, headerRow: 4, merges }];
  for (const g of groups) {
    sheets.push({
      name: g.rubro.slice(0, 31).replace(/[\\/?*[\]:]/g, " "),
      rows: [...header(`${o.title} · ${g.rubro}`), head.map((h) => ({ v: h, s: "headDark" as const })), ...g.items.map(row)],
      widths, headerRow: 4, merges: [`A1:${lastCol}1`, `A2:${lastCol}2`, `A3:${lastCol}3`],
    });
  }
  return sheets;
}
