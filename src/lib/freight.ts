/** Costo de flete: kilómetros estimados (en línea recta × factor de calle) y consumo de la camioneta. */

export type Pt = { lat: number; lng: number };
export type FreightSettings = {
  origin_address: string; vehicle_name: string; consumption_l100: number; fuel_price: number; fuel_price_on: string;
  extra_per_km: number; road_factor: number; share_vehicle_fixed: boolean; fuel_cost_ids: string[]; vehicle_cost_ids: string[];
};
export const DEFAULT_FREIGHT: FreightSettings = {
  origin_address: "Laguna 1311, CABA", vehicle_name: "Mercedes-Benz Sprinter 411 CDI Street",
  // Sprinter 411 CDI cargada, en ciudad con paradas: ~12 l/100 km
  consumption_l100: 12, fuel_price: 2469, fuel_price_on: "2026-11-03", extra_per_km: 0, road_factor: 1.35,
  share_vehicle_fixed: true, fuel_cost_ids: [], vehicle_cost_ids: [],
};

export function haversineKm(a: Pt, b: Pt) {
  const R = 6371, rad = Math.PI / 180;
  const dLat = (b.lat - a.lat) * rad, dLng = (b.lng - a.lng) * rad;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

/** Recorrido del día: sale del depósito, visita las paradas (la más cercana primero) y vuelve. Devuelve km por calle. */
export function routeKm(origin: Pt, stops: Pt[], roadFactor: number) {
  const left = [...stops];
  let cur = origin, km = 0;
  const order: number[] = [];
  while (left.length) {
    let best = 0, bestD = Infinity;
    left.forEach((p, i) => { const d = haversineKm(cur, p); if (d < bestD) { bestD = d; best = i; } });
    km += bestD; cur = left[best]; order.push(stops.indexOf(left[best])); left.splice(best, 1);
  }
  km += haversineKm(cur, origin);
  return { km: Math.round(km * roadFactor * 10) / 10, order };
}

/** Ida y vuelta a una sola parada. */
export const roundTripKm = (origin: Pt, p: Pt, roadFactor: number) => Math.round(haversineKm(origin, p) * 2 * roadFactor * 10) / 10;

export const fuelLiters = (km: number, s: Pick<FreightSettings, "consumption_l100">) => (km * s.consumption_l100) / 100;
/** Costo variable del viaje: gasoil + desgaste por km. */
export const tripCost = (km: number, s: Pick<FreightSettings, "consumption_l100" | "fuel_price" | "extra_per_km">) =>
  Math.round(fuelLiters(km, s) * s.fuel_price + km * s.extra_per_km);

export const normPlace = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ").slice(0, 300);
