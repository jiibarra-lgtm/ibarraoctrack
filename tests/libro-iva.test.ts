import { describe, expect, it } from "vitest";
import { LINE_LENGTH, libroCompras, libroVentas, type LibroVoucher } from "@/lib/libro-iva";

const base: LibroVoucher = {
  issue_date: "2026-11-05", voucher_type: 6, point_of_sale: 4, number: 12, doc_type: "80", doc_number: "30999999993", name: "Hospital Demo Ñandú",
  currency: "ARS", exchange_rate: 1, net_taxed: 1000, net_untaxed: 0, exempt: 0, other_taxes: 0, vat: 210, total: 1210, vat_detail: { "21": { neto: 1000, iva: 210 } },
};

describe("Libro IVA Digital", () => {
  it("ventas: largo fijo y campos en su lugar", () => {
    const { cbte, alicuotas } = libroVentas([base, { ...base, number: 13, vat_detail: { "21": { neto: 100, iva: 21 }, "10.5": { neto: 100, iva: 10.5 } }, total: 231.5 }]);
    expect(cbte.every((l) => l.length === LINE_LENGTH.ventas_cbte)).toBe(true);
    expect(alicuotas.every((l) => l.length === LINE_LENGTH.ventas_alicuotas)).toBe(true);
    expect(alicuotas).toHaveLength(3);
    const l = cbte[0];
    expect(l.slice(0, 8)).toBe("20261105");
    expect(l.slice(8, 11)).toBe("006");
    expect(l.slice(11, 16)).toBe("00004");
    expect(l.slice(16, 36)).toBe("00000000000000000012");
    expect(l.slice(56, 58)).toBe("80");
    expect(l.slice(78, 108)).toBe("Hospital Demo Nandu           ");
    expect(l.slice(108, 123)).toBe("000000000121000");
    expect(l.slice(228, 231)).toBe("PES");
    expect(l.slice(231, 241)).toBe("0001000000");
    expect(l.slice(241, 243)).toBe("10");
    expect(alicuotas[0].slice(43, 47)).toBe("0005");
  });
  it("compras: crédito fiscal sólo en A; B sin alícuotas", () => {
    const a = { ...base, voucher_type: 1 };
    const { cbte, alicuotas } = libroCompras([a, { ...base, number: 20 }]);
    expect(cbte.every((l) => l.length === LINE_LENGTH.compras_cbte)).toBe(true);
    expect(alicuotas.every((l) => l.length === LINE_LENGTH.compras_alicuotas)).toBe(true);
    expect(alicuotas).toHaveLength(1);
    const credito = (l: string) => l.slice(239, 254);
    expect(credito(cbte[0])).toBe("000000000021000");
    expect(credito(cbte[1])).toBe("000000000000000");
  });
});
