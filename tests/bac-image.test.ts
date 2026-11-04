import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
const { ocrImage } = await import("@/lib/bac/ocr");
const { parseBacText } = await import("@/lib/bac/parse-text");
const { validateOrderMath } = await import("@/lib/bac/validate");

// Captura real de BAC → OCR → parser (mismo camino que producción sin IA)
describe("captura PNG de BAC", () => {
  it("se lee completa y las cuentas cierran", async () => {
    const { text } = await ocrImage(readFileSync(join(__dirname, "fixtures/bac-412-17904-OC24.png")));
    const { order, review } = parseBacText(text);
    expect(order.bac_number).toBe("412-17904-OC24");
    expect(order.process_number).toBe("623-0216-LPU23");
    expect(order.customer_name).toBe("412 - HTAL. COSME ARGERICH");
    expect(order.issue_date).toBe("2024-11-12");
    expect(order.total_amount).toBe("132225.00");
    expect(order.items).toHaveLength(1);
    expect(order.items![0].quantity).toBe("15.00");
    expect(order.items![0].unit_price).toBe("8815.00");
    expect(order.items![0].total_amount).toBe("132225.00");
    expect(validateOrderMath(order).warnings).toEqual([]);
    // Lo único dudoso puede ser el CUIT (se corrige con el CUIT de la empresa)
    expect(review.filter((r) => r !== "awardee_cuit")).toEqual([]);
  }, 120_000);
});
