import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { parseBacText } from "@/lib/bac/parse-text";
import { validateOrderMath } from "@/lib/bac/validate";

const fixture = readFileSync(join(__dirname, "fixtures/bac-412-17904-OC24.txt"), "utf8");

describe("parseBacText — OC 412-17904-OC24 (Htal. Argerich)", () => {
  const { order, review, warnings } = parseBacText(fixture);

  it("datos de la orden", () => {
    expect(order.bac_number).toBe("412-17904-OC24");
    expect(order.bac_type).toBe("Original");
    expect(order.fiscal_year).toBe("2024");
    expect(order.issue_date).toBe("2024-11-12");
    expect(order.perfected_date).toBe("2024-11-13");
    expect(order.bac_status).toBe("Perfeccionado");
    expect(order.status).toBe("perfeccionada");
  });

  it("proceso de compra", () => {
    expect(order.process_number).toBe("623-0216-LPU23");
    expect(order.expediente_number).toBe("EX-2023-07838510- -GCABA-DGCYC");
    expect(order.award_act_number).toBe("RS-2023-33167494- -MHFGC");
    expect(order.modality).toBe("Convenio Marco");
    expect(order.process_type).toBe("Bienes");
  });

  it("comprador y adjudicatario", () => {
    expect(order.jurisdiction).toBe("401 - MINISTERIO DE SALUD");
    expect(order.dependencia).toBe("412 - HTAL. COSME ARGERICH");
    expect(order.customer_name).toBe("412 - HTAL. COSME ARGERICH");
    expect(order.buyer_address).toBe("ALMIRANTE BROWN 240");
    expect(order.awardee_cuit).toBe("20-04424052-2");
    expect(order.awardee_name).toBe("JUAN ERNESTO IBARRA");
    expect(order.awardee_entity_number).toBe("32954");
  });

  it("totales", () => {
    expect(order.total_amount).toBe("132225.00");
    expect(order.discount_amount).toBe("0.00");
    expect(order.net_amount).toBe("132225.00");
    expect(order.currency).toBe("ARS");
  });

  it("renglón 3 opción 1", () => {
    expect(order.items).toHaveLength(1);
    const it0 = order.items![0];
    expect(it0.line_number).toBe(3);
    expect(it0.option_number).toBe(1);
    expect(it0.bac_code).toBe("18.10.001.0001.1");
    expect(it0.quantity).toBe("15.00");
    expect(it0.unit).toBe("UNIDAD");
    expect(it0.unit_price).toBe("8815.00");
    expect(it0.total_amount).toBe("132225.00");
    expect(it0.description_original).toMatch(/^AGUA LAVANDINA \(HIPOCLORITO DE SODIO\)/);
    expect(it0.description_original).not.toMatch(/ARS|Ver Detalle|15,00/);
    expect(it0.delivery_term).toMatch(/Durante los 5/);
    expect(it0.delivery_phone).toBe("41210653");
  });

  it("autorizadores", () => {
    expect(order.authorizers).toEqual([{ nombre: "EDUARDO NAPOLI", cargo: "Subdirector", fecha: "2024-11-12" }]);
  });

  it("no deja campos clave en revisión ni errores", () => {
    expect(review).toEqual([]);
    expect(warnings.filter((w) => w.level === "error")).toEqual([]);
  });

  it("la matemática cierra", () => {
    expect(validateOrderMath(order).warnings).toEqual([]);
  });
});

describe("validateOrderMath", () => {
  it("detecta renglón mal calculado y total que no cierra", () => {
    const { warnings, review } = validateOrderMath({
      currency: "ARS",
      total_amount: "1000.00",
      net_amount: "1000.00",
      discount_amount: "0",
      items: [
        { line_number: 1, description_original: "x", quantity: "3", unit_price: "100.10", total_amount: "300.00" },
      ],
    });
    expect(review).toContain("items.0.total_amount");
    expect(review).toContain("total_amount");
    expect(warnings).toHaveLength(2);
  });

  it("tolera redondeo al centavo", () => {
    const { warnings } = validateOrderMath({
      currency: "ARS",
      items: [{ line_number: 1, description_original: "x", quantity: "3", unit_price: "0.335", total_amount: "1.01" }],
    });
    expect(warnings).toEqual([]);
  });
});
