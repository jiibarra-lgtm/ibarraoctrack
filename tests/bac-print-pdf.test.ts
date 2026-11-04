import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { extractText, getDocumentProxy } = await import("unpdf");
const { parseBacText } = await import("@/lib/bac/parse-text");
const { validateOrderMath, fillMissingLineTotals } = await import("@/lib/bac/validate");

// PDFs reales "Imprimir → Guardar como PDF" desde BAC (no se versionan: tienen datos de contacto)
const dir = join(__dirname, "fixtures/real");
async function read(file: string) {
  const pdf = await getDocumentProxy(new Uint8Array(readFileSync(join(dir, file))));
  const { text } = await extractText(pdf, { mergePages: true });
  const ex = parseBacText(text);
  const warnings = [...ex.warnings];
  fillMissingLineTotals(ex.order, ex.review, warnings);
  const math = validateOrderMath(ex.order);
  return { order: ex.order, review: [...ex.review, ...math.review], warnings: [...warnings, ...math.warnings] };
}
const clean = (w: { level: string }[]) => w.filter((x) => x.level !== "info");

describe.skipIf(!existsSync(join(dir, "oc-a.pdf")))("PDF impreso desde BAC", () => {
  it("una página de renglón: se lee completa", async () => {
    const { order, review, warnings } = await read("oc-a.pdf");
    expect(order.bac_number).toBe("3148-18851-OC26");
    expect(order.total_amount).toBe("8046.00");
    expect(order.items).toHaveLength(1);
    expect(order.items![0]).toMatchObject({ quantity: "3.00", unit_price: "2682.00", total_amount: "8046.00" });
    expect(review).toEqual([]);
    expect(clean(warnings)).toEqual([]);
  });
  it("columna Total cortada al imprimir: se calcula y cierra contra el total", async () => {
    const { order, review, warnings } = await read("oc-b.pdf");
    expect(order.bac_number).toBe("614-16527-OC26");
    expect(order.items!.map((i) => i.total_amount)).toEqual(["64298.30", "69000.00", "102000.00"]);
    expect(review).toEqual([]);
    expect(clean(warnings)).toEqual([]);
  });
});
