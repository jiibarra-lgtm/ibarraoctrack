import { describe, expect, it } from "vitest";
import { duplicates, rubroOf, sellers, summarize, type MlOrder, type MlInvoice } from "@/lib/ml-purchases";

const o = (id: string, title: string, total: number, seller = "VEND", at = "2026-11-10T12:00:00Z", extra: Partial<MlOrder> = {}): MlOrder => ({
  id, title, quantity: "1", total_amount: String(total), counterpart: seller, status: "entregada", ordered_at: at, delivered_at: "2026-11-13T12:00:00Z", eta: null, invoice_available: true, created_at: at, ...extra,
});
const inv = (id: string, subject: string, letter: string, total: number, net: number, extra: Partial<MlInvoice> = {}): MlInvoice => ({
  id, mail_subject: subject, supplier_name: "X SRL", letter, total: String(total), net: String(net), issue_date: "2026-11-11", vat: null, other_taxes: null, items: [], ...extra,
});

describe("compras de Mercado Libre", () => {
  it("rubros", () => {
    expect(rubroOf("Cinta De Embalar Transparente 48mm")).toBe("embalaje");
    expect(rubroOf("Lavandina Ayudín 1 Litro")).toBe("limpieza");
    expect(rubroOf("Pistola Pegacable 30/40 W")).toBe("ferreteria");
    expect(rubroOf("Algo raro")).toBe("otros");
  });
  it("IVA, percepciones, envío y lo que se pierde sin factura A", () => {
    const s = summarize(
      [o("1", "Silla Sillon Ejecutivo Gerencial", 230000), o("2", "Bandeja Panaderia Lata", 31347.15), o("3", "Cosa sin factura", 12100)],
      [inv("a", "Silla Sillon Ejecutivo Gerencial Aluminium", "A", 237835.4, 196558.18, { vat: 41277.22, other_taxes: 0 }), inv("b", "Bandeja Panaderia Lata Enlozada", "B", 31347.15, 31347.15)],
    );
    expect(s.vat).toBeCloseTo(41277.22, 2);
    expect(s.shipping).toBeCloseTo(7835.4, 1);
    expect(s.noInvoice).toBe(1);
    expect(s.lostVat).toBeCloseTo((31347.15 + 12100) * 21 / 121, 1);
  });
  it("duplicados", () => {
    expect(duplicates([o("1", "Cinta X", 10), o("2", "Cinta X", 10), o("3", "Cinta X", 10, "OTRO")])).toHaveLength(1);
  });
  it("puntaje de vendedor", () => {
    const r = sellers([o("1", "A", 100), o("2", "B", 100, "VEND", "2026-11-01T12:00:00Z", { delivered_at: "2026-11-12T12:00:00Z", invoice_available: false })],
      [{ id: "r", title: "B", stage: "reembolsada", start_deadline: null, ship_deadline: null, protected_until: null, refunded_at: null, ml_order_id: "2", bank_movement_id: null }], new Map());
    expect(r[0]).toMatchObject({ n: 2, returns: 1, invoiced: 1 });
    expect(r[0].score).toBeLessThan(60);
  });
});
