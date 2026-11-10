import { getDocumentProxy } from "unpdf";

type Item = { str: string; x: number; y: number; w: number; h: number };

/**
 * Texto del PDF reconstruido por hoja y renglón según la posición de cada palabra
 * (como se ve impreso). Los huecos grandes quedan como doble espacio para separar columnas.
 */
export async function pdfLines(bytes: Uint8Array, maxPages = 6): Promise<string[][]> {
  const doc = await getDocumentProxy(bytes);
  const pages: string[][] = [];
  for (let p = 1; p <= Math.min(doc.numPages, maxPages); p++) {
    const page = await doc.getPage(p);
    const tc = await page.getTextContent();
    const items: Item[] = [];
    for (const it of tc.items as { str?: string; transform?: number[]; width?: number; height?: number }[]) {
      if (!it.str || !it.transform || !it.str.trim()) continue;
      const h = Math.abs(it.height || it.transform[3] || 8);
      items.push({ str: it.str, x: it.transform[4], y: it.transform[5], w: it.width ?? it.str.length * h * 0.5, h });
    }
    // agrupa por altura (y) con tolerancia según el tamaño de letra
    items.sort((a, b) => b.y - a.y || a.x - b.x);
    const rows: Item[][] = [];
    for (const it of items) {
      const row = rows.find((r) => Math.abs(r[0].y - it.y) <= Math.max(2, Math.min(r[0].h, it.h) * 0.45));
      if (row) row.push(it); else rows.push([it]);
    }
    rows.sort((a, b) => b[0].y - a[0].y);
    const out: string[] = [];
    for (const r of rows) {
      r.sort((a, b) => a.x - b.x);
      let line = "", end = -Infinity, size = 8;
      for (const it of r) {
        const gap = it.x - end;
        if (line) line += gap > size * 0.9 ? "  " : gap > size * 0.15 && !line.endsWith(" ") && !it.str.startsWith(" ") ? " " : "";
        line += it.str;
        end = it.x + it.w;
        size = it.h || size;
      }
      out.push(line.replace(/\s+$/, ""));
    }
    pages.push(out);
  }
  return pages;
}
