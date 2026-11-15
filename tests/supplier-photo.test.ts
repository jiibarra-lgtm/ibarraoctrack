import { existsSync, readFileSync } from "node:fs";
import { describe, expect, it, vi } from "vitest";
vi.mock("server-only", () => ({}));
import { ocrPhoto } from "@/lib/bac/ocr";
import { parseSupplierInvoice } from "@/lib/invoice/supplier-invoice";

const F = "tests/fixtures/real/argen-7600.png";

describe.skipIf(!existsSync(F))("factura de proveedor en foto (fixture real, no versionada)", () => {
  it("lee cabecera, renglones y totales", async () => {
    const { text } = await ocrPhoto(readFileSync(F));
    const inv = parseSupplierInvoice([text.split(/\r?\n/).filter((l) => l.trim())], { filename: "foto.png" });
    expect(inv).toMatchObject({ letter: "A", point_of_sale: 3, number: 7600, issue_date: "2026-10-05", cae: "86406239820001", net: 1546000, total: 1870660, quality: "ok" });
    expect(inv.items.map((i) => [i.quantity, i.description, i.unit_net])).toEqual([
      [200, "DETERGENTE INTERMEDIO x 5 Lts", 3740],
      [200, "JABON LIQUIDO NACARADO P/MANOS x 5 LTS", 3990],
    ]);
  }, 120000);
});

describe("fecha con guiones", () => {
  it("toma la fecha de emisión dd-mm-aaaa y saltea inicio de actividades y vto. CAE", () => {
    const inv = parseSupplierInvoice([["Factura A", "N° A00003-00007600", "05-10-2026", "Inicio Actividades: 01-09-2006", "Fecha de Vto. de CAE:15-10-2026"]], { filename: "x" });
    expect(inv.issue_date).toBe("2026-10-05");
  });
});
