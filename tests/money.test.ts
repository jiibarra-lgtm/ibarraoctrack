import { describe, expect, it } from "vitest";
import { lineTotal, parseArNumber, sum, differs } from "@/lib/money";
import { parseArDate, formatDate } from "@/lib/format";

describe("parseArNumber", () => {
  it.each([
    ["ARS $132.225,00", "132225.00"],
    ["8815,00", "8815.00"],
    ["15,00", "15.00"],
    ["132225,00", "132225.00"],
    ["1.234.567,89", "1234567.89"],
    ["132.225", "132225"],
    ["8815.00", "8815.00"],
    ["1,234,567.89", "1234567.89"],
    ["$ 0,00", "0.00"],
    ["ARS $132.225.00", "132225.00"],
    ["15", "15"],
  ])("%s → %s", (input, expected) => {
    expect(parseArNumber(input)).toBe(expected);
  });

  it("no inventa ante basura", () => {
    expect(parseArNumber("No definido")).toBeNull();
    expect(parseArNumber("")).toBeNull();
    expect(parseArNumber(null)).toBeNull();
  });
});

describe("aritmética decimal exacta", () => {
  it("evita errores de float", () => {
    expect(sum(["0.10", "0.20"])).toBe("0.30");
    expect(lineTotal("15", "8815")).toBe("132225.00");
    expect(lineTotal("3", "0.335")).toBe("1.01"); // half-up
  });
  it("tolerancia de centavo", () => {
    expect(differs("100.00", "100.01")).toBe(false);
    expect(differs("100.00", "100.02")).toBe(true);
  });
});

describe("fechas", () => {
  it("DD/MM/AAAA ↔ ISO sin corrimiento de zona", () => {
    expect(parseArDate("12/11/2024")).toBe("2024-11-12");
    expect(parseArDate("31/02/2024")).toBeNull();
    expect(formatDate("2024-11-12")).toBe("12/11/2024");
  });
});
