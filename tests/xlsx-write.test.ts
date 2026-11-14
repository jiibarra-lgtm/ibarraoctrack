import { describe, expect, it } from "vitest";
import { writeXlsx } from "@/lib/xlsx-write";
import { readXlsx } from "@/lib/xlsx-lite";
import { backupToXlsx } from "@/lib/backup";

describe("Excel propio", () => {
  it("se puede volver a leer", () => {
    const x = writeXlsx([{ name: "Órdenes", rows: [["OC", "Total"], ["1-2-OC26", 121000.5], ["con <xml> & \"comillas\"", null]] }]);
    expect(readXlsx(x)).toEqual([["OC", "Total"], ["1-2-OC26", 121000.5], ['con <xml> & "comillas"']]);
  });
  it("copia de seguridad con hoja de resumen", () => {
    const x = backupToXlsx({ org: "Test", tables: { purchase_orders: [{ bac_number: "1-2-OC26", total_amount: "121000.00", items: { a: 1 } }] } }, "2026-11-14");
    const first = readXlsx(x);
    expect(first[0]).toEqual(["Copia de seguridad", "Test"]);
    expect(first.find((r) => r[0] === "Órdenes")?.[1]).toBe(1);
  });
});
