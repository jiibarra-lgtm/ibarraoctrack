import { describe, expect, it } from "vitest";
import { haversineKm, roundTripKm, routeKm, tripCost } from "@/lib/freight";

const deposito = { lat: -34.6447, lng: -58.4719 }; // Laguna 1311
const munuz = { lat: -34.6349, lng: -58.3995 };     // Uspallata 2272
const colon = { lat: -34.6011, lng: -58.3831 };     // Cerrito 618

describe("flete", () => {
  it("distancia en línea recta", () => {
    expect(Math.round(haversineKm(deposito, munuz))).toBe(7);
  });
  it("ida y vuelta con factor de calle", () => {
    expect(roundTripKm(deposito, munuz, 1.35)).toBeCloseTo(18.0, 0);
  });
  it("recorrido del día sale y vuelve, visitando la más cercana primero", () => {
    const r = routeKm(deposito, [colon, munuz], 1.35);
    expect(r.order).toEqual([1, 0]);
    expect(r.km).toBeLessThan(roundTripKm(deposito, munuz, 1.35) + roundTripKm(deposito, colon, 1.35));
  });
  it("costo: gasoil + desgaste", () => {
    // 20 km × 12 l/100 = 2,4 l × $2.469 = $5.926 + 20 × $50
    expect(tripCost(20, { consumption_l100: 12, fuel_price: 2469, extra_per_km: 50 })).toBe(6926);
  });
});
