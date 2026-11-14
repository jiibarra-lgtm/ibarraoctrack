import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { parseBacText } = await import("@/lib/bac/parse-text");

// Texto OCR de OCs reales de varias páginas (no se versionan): renglones repetidos por el corte de página,
// renglones que sólo figuran en la tabla de entrega, códigos leídos con coma.
const dir = join(__dirname, "fixtures/real");
const cases: [string, number, string][] = [
  ["ocr-3148-19232-OC26.txt", 2, "236794.00"],
  ["ocr-422-18716-OC26.txt", 5, "2051508.52"],
  ["ocr-427-19370-OC26.txt", 2, "585920.00"],
  ["ocr-432-18757-OC26.txt", 7, "8093244.00"],
  ["ocr-437-19394-OC26.txt", 2, "183900.00"],
  ["ocr-525-19297-OC26.txt", 4, "17860260.00"],
];

describe.skipIf(!existsSync(join(dir, cases[0][0])))("OCR de OCs con varios renglones", () => {
  it.each(cases)("%s", (file, n, net) => {
    const { order, review } = parseBacText(readFileSync(join(dir, file), "utf8"));
    expect(order.items).toHaveLength(n);
    expect(order.net_amount).toBe(net);
    const sum = order.items!.reduce((a, it) => a + Number(it.total_amount), 0);
    expect(sum.toFixed(2)).toBe(net);
    for (const it of order.items!) expect((Number(it.quantity) * Number(it.unit_price)).toFixed(2)).toBe(Number(it.total_amount).toFixed(2));
    expect(review).toEqual([]);
  });
  it("descripción tomada de la tabla de entrega cuando el OCR la separa del renglón", () => {
    const { order, review } = parseBacText(readFileSync(join(dir, "ocr-414-19088-OC26.txt"), "utf8"));
    expect(order.items![0].description_original).toMatch(/^BOLSA PARA OBITO/);
    expect(review).toEqual([]);
  });
  it("renglón que sólo figura en la entrega toma lo que falta para el neto", () => {
    const { order } = parseBacText(readFileSync(join(dir, "ocr-432-18757-OC26.txt"), "utf8"));
    expect(order.items!.find((it) => it.line_number === 2)).toMatchObject({ quantity: "12.00", unit_price: "92400.00", total_amount: "1108800.00" });
  });
});
