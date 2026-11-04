import { describe, expect, it } from "vitest";
import { matchRemitoLines, readRemitoHeader } from "@/lib/remito/parse";

const remito = `IBARRA INSUMOS
REMITO N° 0001-00004521
Fecha: 18/11/2024
Destino: HTAL. COSME ARGERICH - División Depósito
Orden de compra: 412-17904-0C24
Cant.   Descripción
6       18.10.001.0001.1 AGUA LAVANDINA (HIPOCLORITO DE SODIO) bidón 5 lts
Recibí conforme
Firma: ______________  Aclaración: ________`;

const items = [
  { id: "a", line_number: 3, bac_code: "18.10.001.0001.1", description_original: "AGUA LAVANDINA (HIPOCLORITO DE SODIO) Liquido amarillento", quantity: "15" },
  { id: "b", line_number: 4, bac_code: "18.10.002.0003.1", description_original: "DETERGENTE CONCENTRADO NEUTRO", quantity: "10" },
];

describe("lectura de remito", () => {
  it("cabecera", () => {
    const h = readRemitoHeader(remito);
    expect(h.remito_number).toBe("0001-00004521");
    expect(h.date).toBe("2024-11-18");
    expect(h.oc_numbers).toEqual(["412-17904-OC24"]);
    expect(h.signature_block).toBe(true);
  });
  it("renglón por código y cantidad (sin confundir 5 lts)", () => {
    const l = matchRemitoLines(remito, items);
    expect(l).toEqual([expect.objectContaining({ purchase_order_item_id: "a", quantity: "6", confidence: "alta" })]);
  });
  it("por descripción cuando no hay código", () => {
    const l = matchRemitoLines("4  DETERGENTE CONCENTRADO NEUTRO x 5 lts", items);
    expect(l[0]).toMatchObject({ purchase_order_item_id: "b", quantity: "4", confidence: "media" });
  });
});
