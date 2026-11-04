import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it, vi } from "vitest";

vi.mock("server-only", () => ({}));
vi.mock("sharp", () => ({ default: vi.fn() }));

const { mapAiPayload } = await import("@/lib/bac/ai");
const { mergeExtractions } = await import("@/lib/bac/merge");
const { parseBacText } = await import("@/lib/bac/parse-text");

// Lo que devolvería la IA leyendo la captura de la OC 412-17904-OC24
const aiPayload = {
  numero_orden: "412-17904-OC24", tipo: "Original", ejercicio: "2024", fecha_autorizacion: "12/11/2024",
  fecha_perfeccionamiento: "13/11/2024", estado: "Perfeccionado", duracion_contrato: "No definido",
  numero_expediente: "EX-2023-07838510- -GCABA-DGCYC", numero_procedimiento: "623-0216-LPU23", tipo_proceso: "Bienes",
  modalidad: "Convenio Marco", clase: null, encuadre_legal: null, acto_adjudicacion: "RS-2023-33167494- -MHFGC",
  jurisdiccion_solicitante: "401 - MINISTERIO DE SALUD", unidad_ejecutora: "412 - HTAL. COSME ARGERICH",
  telefono_comprador: "4121-0700 INTERNO 2653", direccion_comprador: "ALMIRANTE BROWN 240",
  observaciones_comprador: "ENTREGA EN DIVISION DEPOSITO - SRA CLAUDIA POMA ENTREGAR EN BIDONES DE 5 LITROS",
  razon_social_adjudicatario: "JUAN ERNESTO IBARRA", numero_ente: "32954", cuit_adjudicatario: "20-04424052-2",
  importe_total: "ARS $132.225,00", importe_bonificado: "ARS $0,00", importe_neto: "ARS $132.225,00", moneda: "ARS",
  renglones: [{
    renglon: 3, opcion: 1, codigo_catalogo: "18.10.001.0001.1", descripcion: "AGUA LAVANDINA (HIPOCLORITO DE SODIO) Liquido amarillento",
    cantidad: "15,00", unidad_medida: "UNIDAD", empaquetamiento: null, precio_unitario: "ARS 8815,00", total: "ARS 132225,00",
    entrega_direccion: "CORBETA PI Y MARGALL 750", entrega_telefono: "41210653",
    entrega_plazo: "Durante los 5 a partir de Días hábiles", entrega_observaciones: "ENTREGA BIDONES DE 5 LITROS",
  }],
  autorizadores: [{ nombre: "EDUARDO NAPOLI", cargo: "Subdirector", fecha: "12/11/2024" }],
  campos_dudosos: [],
};

describe("mapAiPayload", () => {
  const { order, review } = mapAiPayload(aiPayload);
  it("convierte importes y fechas sin inventar", () => {
    expect(order.total_amount).toBe("132225.00");
    expect(order.issue_date).toBe("2024-11-12");
    expect(order.items![0].unit_price).toBe("8815.00");
    expect(order.items![0].quantity).toBe("15.00");
    expect(order.customer_name).toBe("412 - HTAL. COSME ARGERICH");
    expect(order.status).toBe("perfeccionada");
    expect(order.delivery_term_days).toBe("5");
    expect(review).toEqual([]);
  });
  it("marca como revisión lo dudoso o nulo", () => {
    const r = mapAiPayload({ ...aiPayload, importe_total: null, campos_dudosos: ["numero_expediente"], renglones: [{ ...aiPayload.renglones[0], precio_unitario: null }] });
    expect(r.review).toEqual(expect.arrayContaining(["total_amount", "expediente_number", "items.0.unit_price"]));
    expect(r.order.items![0].unit_price).toBe("");
  });
});

describe("mergeExtractions", () => {
  const text = parseBacText(readFileSync(join(__dirname, "fixtures/bac-412-17904-OC24.txt"), "utf8"));
  it("doble lectura coincidente: sin revisiones y descripción completa del texto", () => {
    const m = mergeExtractions(text, mapAiPayload(aiPayload));
    expect(m.review).toEqual([]);
    expect(m.order.items![0].description_original!.length).toBeGreaterThan(100);
  });
  it("si texto e IA difieren en un importe, queda para revisar", () => {
    const ai = mapAiPayload({ ...aiPayload, renglones: [{ ...aiPayload.renglones[0], precio_unitario: "ARS 8615,00" }] });
    const m = mergeExtractions(text, ai);
    expect(m.review).toContain("items.0.unit_price");
    expect(m.warnings.some((w) => w.path === "items.0.unit_price")).toBe(true);
  });
});
