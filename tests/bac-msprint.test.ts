import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { extractText, getDocumentProxy } = await import("unpdf");
const { renderPdfPages } = await import("@/lib/bac/pdf-images");
const { ocrImages } = await import("@/lib/bac/ocr");
const { parseBacText } = await import("@/lib/bac/parse-text");
const { validateOrderMath, fillMissingLineTotals } = await import("@/lib/bac/validate");

// PDFs reales impresos con "Microsoft Print to PDF" (letras guardadas como dibujos, sin texto). No se versionan.
const dir = join(__dirname, "fixtures/real");
async function read(file: string) {
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(join(dir, file))));
  const { text } = await extractText(pdf, { mergePages: true });
  expect(text.replace(/\s/g, "").length).toBeLessThan(200); // mismo camino que el importador: sin texto → OCR
  const pages = await renderPdfPages(pdf);
  const { text: ocr } = await ocrImages(pages);
  const ex = parseBacText(ocr);
  const warnings = [...ex.warnings];
  fillMissingLineTotals(ex.order, ex.review, warnings);
  const math = validateOrderMath(ex.order);
  return { order: ex.order, review: [...ex.review, ...math.review], pages: pages.length };
}

describe.skipIf(!existsSync(join(dir, "msprint-420.pdf")))("PDF de 'Microsoft Print to PDF'", () => {
  it("tabla partida y números mal leídos: cierra con la tabla de entrega y el neto", async () => {
    const { order, review, pages } = await read("msprint-420.pdf");
    expect(pages).toBe(4);
    expect(order).toMatchObject({ bac_number: "420-18786-OC26", process_number: "623-1245-LPU24", total_amount: "25603800.00", issue_date: "2026-11-04" });
    expect(order.items).toHaveLength(1);
    expect(order.items![0]).toMatchObject({ line_number: 87, bac_code: "18.06.007.0002.8", quantity: "2085.00", unit_price: "12280.00", total_amount: "25603800.00" });
    expect(review).toEqual([]);
  }, 240000);
  it("columnas de cantidad y precio impresas después de los totales", async () => {
    const { order, review } = await read("msprint-7307.pdf");
    expect(order).toMatchObject({ bac_number: "7307-19256-OC26", total_amount: "44800.00" });
    expect(order.items).toHaveLength(1);
    expect(order.items![0]).toMatchObject({ line_number: 47, bac_code: "07.02.003.0002.2", quantity: "4.00", unit_price: "11200.00", total_amount: "44800.00" });
    expect(review).toEqual([]);
  }, 240000);
});
