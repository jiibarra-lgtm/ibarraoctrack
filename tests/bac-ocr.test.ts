import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBacText, validCuit } from "@/lib/bac/parse-text";
import { validateOrderMath } from "@/lib/bac/validate";

// Texto real devuelto por el OCR (Tesseract) sobre la captura de la OC 412-17904-OC24
const ocr = readFileSync(join(__dirname, "fixtures/bac-412-17904-OC24.ocr.txt"), "utf8");

describe("parseBacText con texto de OCR (formato por filas)", () => {
  const { order, review } = parseBacText(ocr);
  it("corrige O/0 en el número de OC", () => expect(order.bac_number).toBe("412-17904-OC24"));
  it("datos de orden y proceso", () => {
    expect(order.issue_date).toBe("2024-11-12");
    expect(order.perfected_date).toBe("2024-11-13");
    expect(order.status).toBe("perfeccionada");
    expect(order.process_number).toBe("623-0216-LPU23");
    expect(order.expediente_number).toBe("EX-2023-07838510- -GCABA-DGCYC");
    expect(order.award_act_number).toBe("RS-2023-33167494- -MHFGC");
    expect(order.modality).toBe("Convenio Marco");
  });
  it("comprador por columnas", () => {
    expect(order.jurisdiction).toBe("401 - MINISTERIO DE SALUD");
    expect(order.customer_name).toBe("412 - HTAL. COSME ARGERICH");
    expect(order.buyer_address).toBe("ALMIRANTE BROWN 240");
    expect(order.buyer_phone).toBe("4121-0700 INTERNO 2653");
  });
  it("adjudicatario por columnas; CUIT mal leído queda para revisar", () => {
    expect(order.awardee_name).toBe("JUAN ERNESTO IBARRA");
    expect(order.awardee_entity_number).toBe("32954");
    expect(review).toContain("awardee_cuit"); // OCR leyó 20-04424092-2
  });
  it("totales con punto decimal de OCR", () => {
    expect(order.total_amount).toBe("132225.00");
    expect(order.net_amount).toBe("132225.00");
    expect(order.discount_amount).toBe("0.00");
  });
  it("renglón con total en la línea siguiente", () => {
    const i = order.items![0];
    expect(i.line_number).toBe(3);
    expect(i.bac_code).toBe("18.10.001.0001.1");
    expect(i.quantity).toBe("15.00");
    expect(i.unit).toBe("UNIDAD");
    expect(i.unit_price).toBe("8815.00");
    expect(i.total_amount).toBe("132225.00");
    expect(i.description_original).toMatch(/^AGUA LAVANDINA \(HIPOCLORITO DE SODIO\) Liquido amarillento/);
  });
  it("cuentas cierran", () => expect(validateOrderMath(order).warnings).toEqual([]));
});

describe("validCuit", () => {
  it("verifica dígito", () => {
    expect(validCuit("20-04424052-2")).toBe(true);
    expect(validCuit("20-04424092-2")).toBe(false);
  });
});
