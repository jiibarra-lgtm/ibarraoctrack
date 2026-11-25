import { describe, expect, it } from "vitest";
import { abWinner, accountScore, buildTitle, commercialCalendar, conversion, daysOfStock, duplicates, inBusinessHours, matchAnswer, missingKeywords, netPerUnit, nextEvents, priceForMargin, quantityTiers, repriceTarget, saleStage, wordFreq } from "@/lib/ml/logic";

describe("ML: neto y precios", () => {
  it("neto por unidad con comisión, envío, IIBB y costo", () => {
    const n = netPerUnit({ price: 121000, fee: 16940, ship: 12100, cost: 50000, iibbPct: 5 });
    expect(n.priceNet).toBe(100000);
    expect(n.iibb).toBe(5000);
    expect(n.net).toBe(100000 - 14000 - 10000 - 5000 - 50000);
    expect(n.margin).toBe(21);
  });
  it("precio para un margen da exactamente ese margen", () => {
    const p = priceForMargin(50000, 21, 14, 12100, 5)!;
    const n = netPerUnit({ price: p, fee: p * 0.14, ship: 12100, cost: 50000, iibbPct: 5 });
    expect(n.margin).toBeCloseTo(21, 1);
  });
  it("repricing respeta piso y techo", () => {
    const rule = { strategy: "match_lowest" as const, min_price: 1000, max_price: 2000, margin_pct: null, step: 10 };
    expect(repriceTarget(rule, { current: 1500, priceToWin: null, lowestCompetitor: 900, cost: null })).toBe(1000);
    expect(repriceTarget(rule, { current: 1500, priceToWin: null, lowestCompetitor: 1300, cost: null })).toBe(1290);
    expect(repriceTarget(rule, { current: 1290, priceToWin: null, lowestCompetitor: 1300, cost: null })).toBeNull();
  });
  it("escalones mayoristas", () => {
    expect(quantityTiers(10)).toEqual([{ min: 2, pct: 3.5 }, { min: 5, pct: 6 }, { min: 10, pct: 8 }, { min: 25, pct: 10 }]);
  });
});

describe("ML: palabras clave y títulos", () => {
  it("palabras buscadas que faltan en el título", () => {
    expect(missingKeywords("Bolsa De Residuos Negra 60x90", ["bolsas consorcio", "bolsa residuos reforzada 60x90"])).toEqual(expect.arrayContaining(["consorcio", "reforzada"]));
  });
  it("arma títulos de hasta 60 caracteres sin repetir", () => {
    const t = buildTitle("Bolsa De Residuos 60x90", ["consorcio", "reforzada", "negra", "residuos"]);
    expect(t.length).toBeLessThanOrEqual(60);
    expect(t).toBe("Bolsa De Residuos 60x90 Consorcio Reforzada Negra");
  });
  it("frecuencia de palabras", () => {
    expect(wordFreq(["¿hacen factura A?", "factura a nombre de empresa"])[0]).toEqual({ word: "factura", n: 2 });
  });
});

describe("ML: preguntas", () => {
  const rules = [
    { id: "1", name: "Factura", keywords: ["factura"], answer: "Hola, sí", active: true },
    { id: "2", name: "Stock", keywords: ["stock", "hay"], answer: "Hola, hay", active: true },
  ];
  it("elige la regla que coincide", () => {
    expect(matchAnswer("¿Hacen FACTURA A?", rules)?.id).toBe("1");
    expect(matchAnswer("tenés stock? hay?", rules)?.id).toBe("2");
    expect(matchAnswer("de qué color es", rules)).toBeNull();
  });
  it("horario de atención (hora argentina)", () => {
    expect(inBusinessHours(new Date("2026-11-25T13:00:00Z"), 8, 18, [1, 2, 3, 4, 5])).toBe(true); // miércoles 10 hs
    expect(inBusinessHours(new Date("2026-11-25T23:30:00Z"), 8, 18, [1, 2, 3, 4, 5])).toBe(false); // 20:30
    expect(inBusinessHours(new Date("2026-11-29T15:00:00Z"), 8, 18, [1, 2, 3, 4, 5])).toBe(false); // domingo
  });
});

describe("ML: tablero", () => {
  it("puntaje de la cuenta y lo que más resta", () => {
    const s = accountScore({ level: "1_red", avgHealth: 90, answeredPct: 100, avgAnswerHours: 1, withStockPct: 100, competitivePct: 70 });
    expect(s.worst).toBe("Reputación");
    expect(s.total).toBeGreaterThan(50);
  });
  it("A/B, stock, duplicadas, conversión", () => {
    expect(abWinner({ a: { days: 3, visits: 30, sold: 3 }, b: { days: 3, visits: 30, sold: 6 } }).winner).toBe("b");
    expect(abWinner({ a: { days: 1, visits: 3, sold: 1 }, b: { days: 3, visits: 30, sold: 6 } }).winner).toBeNull();
    expect(daysOfStock(100, 30)).toBe(100);
    expect(daysOfStock(100, 0)).toBeNull();
    expect(duplicates([{ id: "a", title: "Bolsa residuos negra 60x90", status: "active" }, { id: "b", title: "Bolsa de residuos 60x90 negra reforzada", status: "active" }, { id: "c", title: "Guantes de nitrilo", status: "active" }])).toEqual([{ a: "a", b: "b", score: 1 }]);
    expect(conversion(3, 150)).toBe(2);
  });
  it("calendario comercial y etapa de la venta", () => {
    expect(commercialCalendar(2026).find((e) => e.name === "Black Friday")?.date).toBe("2026-11-27");
    expect(nextEvents("2026-11-25", 1)[0]).toMatchObject({ name: "Black Friday", days: 2 });
    expect(saleStage({ status: "paid", shipStatus: "ready_to_ship", shipSub: "ready_to_print", handlingLimit: "2026-11-01T00:00:00Z" }, new Date("2026-11-02")).key).toBe("preparar");
    expect(saleStage({ status: "paid", shipStatus: "delivered", shipSub: null, handlingLimit: null }).key).toBe("entregada");
  });
});
