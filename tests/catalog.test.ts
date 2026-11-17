import { describe, expect, it } from "vitest";
import { buildCatalog, catalogWorkbook, splitProduct } from "@/lib/catalog";
import { writeStyledXlsx } from "@/lib/xlsx-styled";

const line = (n: number, product: string, price: number, code = "18.10.001.0001.1") => ({
  contract_number: "623-20-CM26", convenio_name: "Adquisición de Artículos de Limpieza", line_number: n, item_code: code, unit: "UNIDAD",
  product_name: product, item_description: null, my_spec: "Líquido amarillento", my_current_price: price, my_stock: 10,
});

describe("catálogo", () => {
  it("separa nombre, presentación y marca", () => {
    expect(splitProduct("AGUA LAVANDINA (HIPOCLORITO DE SODIO) - AYUDA SOCIAL A PERSONAS · Bidón x 1 litro · marca DRUCKE", null))
      .toEqual({ name: "Agua Lavandina (Hipoclorito de Sodio)", presentation: "Bidón x 1 litro", brand: "DRUCKE" });
  });
  it("no repite el mismo producto de dos renglones (ayuda social)", () => {
    const g = buildCatalog([
      line(1, "AGUA LAVANDINA · Bidón x 1 litro · marca DRUCKE", 990),
      line(2, "AGUA LAVANDINA - AYUDA SOCIAL A PERSONAS · Bidón x 1 litro · marca DRUCKE", 990, "32.01.195.0049.1"),
      line(3, "AGUA LAVANDINA · Bidón x 10 litros · marca DRUCKE", 8200),
    ]);
    expect(g).toHaveLength(1);
    expect(g[0].rubro).toBe("Limpieza");
    expect(g[0].items).toHaveLength(2);
    expect(g[0].items.find((i) => i.presentation === "Bidón x 1 litro")!.codes).toEqual(["18.10.001.0001.1", "32.01.195.0049.1"]);
  });
  it("arma un Excel válido con y sin precios", () => {
    const g = buildCatalog([line(1, "BALDE · marca D.PLAST", 2500)]);
    for (const prices of [true, false]) {
      const sheets = catalogWorkbook(g, { prices, specs: true, title: "Catálogo", company: { name: "Ibarra Insumos" }, date: "2026-11-17" });
      expect(sheets.map((s) => s.name)).toEqual(["Catálogo", "Limpieza"]);
      expect(writeStyledXlsx(sheets).length).toBeGreaterThan(1000);
    }
  });
});
