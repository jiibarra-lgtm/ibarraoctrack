import { describe, expect, it } from "vitest";
import { unzipSync, strFromU8 } from "fflate";
import { advise } from "@/lib/price-advice";
import { priceWorkbook } from "@/lib/price-export";
import { writeStyledXlsx } from "@/lib/xlsx-styled";

const L = (n: number, price: number, best: number | null, cost: number | null, stock = [100, 50]) =>
  advise({ contract_number: "623-20-CM26", line_number: n, option_number: 1, product_name: `Producto ${n}`, my_current_price: price, best_other_price: best, cost, my_stock: stock[0], my_stock_balance: stock[1] });

describe("priceWorkbook", () => {
  const rows = [L(1, 8200, 7970, 5559.5), L(2, 990, 900, 800), L(3, 500, 450, null), L(4, 1000, 1200, 500, [100, 5]), L(5, 1000, 1005, 500)];
  const wb = priceWorkbook(rows, "2026-11-16");
  it("separa cada situación en su hoja", () => {
    expect(wb.map((s) => s.name)).toEqual(["Resumen", "1 Bajá el precio", "2 No te da", "3 Sin costo", "4 Podés subir", "5 Dejalo así", "6 Stock"]);
    const dataRows = (i: number) => wb[i].rows.slice(4).filter((r) => r.length > 3).length;
    expect([dataRows(1), dataRows(2), dataRows(3), dataRows(5), dataRows(6)]).toEqual([1, 1, 1, 1, 1]);
    expect(dataRows(4)).toBe(2); // 1 renglón + total
  });
  it("genera un xlsx válido con estilos", () => {
    const files = unzipSync(writeStyledXlsx(wb));
    expect(Object.keys(files)).toContain("xl/worksheets/sheet7.xml");
    const styles = strFromU8(files["xl/styles.xml"]);
    expect(styles).toContain('formatCode="0.0%"');
    const s2 = strFromU8(files["xl/worksheets/sheet2.xml"]);
    expect(s2).toContain("<autoFilter");
    expect(s2).toContain("Te ganan y te da para bajar");
  });
});
