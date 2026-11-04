import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { extractText, getDocumentProxy } from "unpdf";
import { parseBacText } from "@/lib/bac/parse-text";
import { validateOrderMath } from "@/lib/bac/validate";

// PDF impreso desde la grilla de "Ver documento contractual" (mismo pipeline que producción: unpdf → parser)
describe("PDF BAC real → extracción de texto → parser", async () => {
  const buf = readFileSync(join(__dirname, "fixtures/bac-412-17904-OC24.pdf"));
  const { text } = await extractText(await getDocumentProxy(new Uint8Array(buf)), { mergePages: true });
  const { order, review } = parseBacText(text);

  it("campos clave", () => {
    expect(order.bac_number).toBe("412-17904-OC24");
    expect(order.process_number).toBe("623-0216-LPU23");
    expect(order.expediente_number).toBe("EX-2023-07838510- -GCABA-DGCYC");
    expect(order.issue_date).toBe("2024-11-12");
    expect(order.perfected_date).toBe("2024-11-13");
    expect(order.awardee_cuit).toBe("20-04424052-2");
    expect(order.total_amount).toBe("132225.00");
    expect(order.dependencia).toBe("412 - HTAL. COSME ARGERICH");
  });
  it("renglón", () => {
    const it0 = order.items![0];
    expect(it0.line_number).toBe(3);
    expect(it0.bac_code).toBe("18.10.001.0001.1");
    expect(it0.quantity).toBe("15.00");
    expect(it0.unit_price).toBe("8815.00");
    expect(it0.total_amount).toBe("132225.00");
  });
  it("cuentas y revisión", () => {
    expect(validateOrderMath(order).warnings).toEqual([]);
    expect(review).toEqual([]);
  });
});
