import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { getDocumentProxy, extractText } = await import("unpdf");
const { pdfToImage } = await import("@/lib/bac/pdf-images");
const { ocrImage } = await import("@/lib/bac/ocr");
const { parseBacText } = await import("@/lib/bac/parse-text");
const { validateOrderMath } = await import("@/lib/bac/validate");

// Capturas guardadas como PDF (FireShot): sin capa de texto, una página larga o varias páginas
describe.each(["fireshot-single.pdf", "fireshot-pages.pdf"])("PDF de captura %s", (file) => {
  it("se lee con OCR y las cuentas cierran", async () => {
    const pdf = await getDocumentProxy(new Uint8Array(readFileSync(join(__dirname, "fixtures", file))));
    const { text: layer } = await extractText(pdf, { mergePages: true });
    expect(layer.replace(/\s/g, "").length).toBeLessThan(200);
    const img = await pdfToImage(pdf);
    expect(img).not.toBeNull();
    const { order, review } = parseBacText((await ocrImage(img!)).text);
    expect(order.bac_number).toBe("412-17904-OC24");
    expect(order.customer_name).toBe("412 - HTAL. COSME ARGERICH");
    expect(order.total_amount).toBe("132225.00");
    expect(order.items![0].quantity).toBe("15.00");
    expect(order.items![0].unit_price).toBe("8815.00");
    expect(validateOrderMath(order).warnings).toEqual([]);
    expect(review.filter((r) => r !== "awardee_cuit")).toEqual([]);
  }, 180_000);
});
