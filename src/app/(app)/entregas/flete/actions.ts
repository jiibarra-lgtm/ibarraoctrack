"use server";
import { revalidatePath } from "next/cache";
import { z } from "zod";
import { requireOrg, canWrite } from "@/lib/session";
import { friendlyDbError } from "@/lib/errors";
import { normPlace } from "@/lib/freight";

type R = { ok: true; msg?: string; done?: number } | { ok: false; error: string };
const can = (role: string) => canWrite(role as never) || role === "logistica";

const settingsSchema = z.object({
  origin_address: z.string().trim().min(3).max(300),
  vehicle_name: z.string().trim().min(1).max(120),
  consumption_l100: z.number().min(3).max(40),
  fuel_price: z.number().positive().max(1e6),
  extra_per_km: z.number().min(0).max(1e5),
  road_factor: z.number().min(1).max(3),
  share_vehicle_fixed: z.boolean(),
  fuel_cost_ids: z.array(z.string().uuid()).max(20),
  vehicle_cost_ids: z.array(z.string().uuid()).max(20),
});

export async function saveFreightSettings(input: z.input<typeof settingsSchema>): Promise<R> {
  const s = await requireOrg();
  if (!can(s.org.role)) return { ok: false, error: "Tu rol no permite cambiar esto" };
  const p = settingsSchema.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
  const { data: prev } = await s.supabase.from("freight_settings").select("fuel_price").eq("org_id", s.org.org_id).maybeSingle();
  const priceChanged = !prev || Number(prev.fuel_price) !== p.data.fuel_price;
  const { error } = await s.supabase.from("freight_settings").upsert({
    org_id: s.org.org_id, ...p.data, updated_at: new Date().toISOString(),
    ...(priceChanged ? { fuel_price_on: new Date(Date.now() - 3 * 3600e3).toISOString().slice(0, 10) } : {}),
  });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/entregas/flete");
  return { ok: true };
}

/** Kilómetros a mano para un lugar que no se encontró en el mapa (ida y vuelta). */
export async function setManualKm(query: string, km: number | null): Promise<R> {
  const s = await requireOrg();
  if (!can(s.org.role)) return { ok: false, error: "No permitido" };
  const q = normPlace(query);
  if (q.length < 3 || (km !== null && !(km >= 0 && km <= 2000))) return { ok: false, error: "Kilómetros inválidos" };
  const { error } = await s.supabase.from("geo_places").upsert({ org_id: s.org.org_id, query: q, km_manual: km, status: km === null ? "no_encontrada" : "manual", updated_at: new Date().toISOString() });
  if (error) return { ok: false, error: friendlyDbError(error) };
  revalidatePath("/entregas/flete");
  return { ok: true };
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

type Geo = { lat: number; lng: number; label: string };

/** Georef (API oficial del Estado argentino): normaliza calles con altura de CABA y provincia de Buenos Aires. */
async function georef(addr: string, provincia: string): Promise<Geo | null> {
  const url = new URL("https://apis.datos.gob.ar/georef/api/direcciones");
  url.searchParams.set("direccion", addr);
  url.searchParams.set("provincia", provincia);
  url.searchParams.set("max", "1");
  const res = await fetch(url, { cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`georef ${res.status}`);
  const j = (await res.json()) as { direcciones?: { nomenclatura?: string; ubicacion?: { lat: number | null; lon: number | null } }[] };
  const d = j.direcciones?.[0];
  return d?.ubicacion?.lat != null && d.ubicacion.lon != null ? { lat: d.ubicacion.lat, lng: d.ubicacion.lon, label: (d.nomenclatura ?? addr).slice(0, 300) } : null;
}

/** OpenStreetMap: sirve para nombres de lugares (hospitales, museos) que no son una calle con altura. */
async function nominatim(q: string): Promise<Geo | null> {
  const url = new URL("https://nominatim.openstreetmap.org/search");
  url.searchParams.set("format", "jsonv2");
  url.searchParams.set("limit", "1");
  url.searchParams.set("countrycodes", "ar");
  url.searchParams.set("viewbox", "-58.95,-34.25,-57.95,-35.05");
  url.searchParams.set("bounded", "1");
  url.searchParams.set("q", q);
  const res = await fetch(url, { headers: { "User-Agent": "OCTrack/1.0 (ibarraoctrack.vercel.app)", "Accept-Language": "es" }, cache: "no-store", signal: AbortSignal.timeout(8000) });
  if (!res.ok) throw new Error(`osm ${res.status}`);
  const j = (await res.json()) as { lat: string; lon: string; display_name: string }[];
  return j[0] ? { lat: Number(j[0].lat), lng: Number(j[0].lon), label: j[0].display_name.slice(0, 300) } : null;
}

/** Prueba Georef (CABA y después provincia) y, si no, OpenStreetMap con la dirección y con el nombre del lugar. */
async function geocode(addr: string, place: string): Promise<{ geo: Geo | null; errors: string[]; answered: number }> {
  const errors: string[] = [];
  let answered = 0;
  const clean = addr.replace(/\b(av\.?|avda\.?)\s/gi, "Avenida ").replace(/\s+/g, " ").trim();
  const tries: (() => Promise<Geo | null>)[] = [];
  if (/\d/.test(clean)) tries.push(() => georef(clean, "02"), () => georef(clean, "06"));
  tries.push(() => nominatim(`${clean}, Buenos Aires, Argentina`));
  if (place) tries.push(() => nominatim(`${place}, Buenos Aires, Argentina`));
  for (const t of tries) {
    try { const g = await t(); answered++; if (g) return { geo: g, errors, answered }; } catch (e) { errors.push((e as Error).message); }
    await sleep(350);
  }
  return { geo: null, errors, answered };
}

/** Ubica en el mapa las direcciones que faltan (de a 1 por segundo, como pide OpenStreetMap). */
export async function locatePlaces(places: { query: string; fallback?: string }[]): Promise<R> {
  const s = await requireOrg();
  if (!can(s.org.role)) return { ok: false, error: "No permitido" };
  const list = places.slice(0, 25).map((p) => ({ q: normPlace(p.query), fb: p.fallback ? p.fallback.trim().slice(0, 200) : "" })).filter((p) => p.q.length >= 3);
  let found = 0, missing = 0;
  const started = Date.now();
  const errs = new Set<string>();
  let done = 0;
  for (const p of list) {
    if (Date.now() - started > 40_000) break;
    done++;
    const { geo: g, errors, answered } = await geocode(p.q, p.fb);
    errors.forEach((e) => errs.add(e));
    // si ningún servicio respondió, no la marco como "no encontrada": se reintenta la próxima vez
    if (!g && !answered) { missing++; continue; }
    const { error } = await s.supabase.from("geo_places").upsert({
      org_id: s.org.org_id, query: p.q, lat: g?.lat ?? null, lng: g?.lng ?? null, label: g?.label ?? null,
      status: g ? "ok" : "no_encontrada", updated_at: new Date().toISOString(),
    });
    if (error) return { ok: false, error: friendlyDbError(error) };
    if (g) found++; else missing++;
  }
  if (!found && errs.size) {
    console.error("[flete] geocodificación falló", [...errs]);
    return { ok: false, error: `No pude consultar el mapa (${[...errs].slice(0, 2).join(", ")}). Probá de nuevo en un rato.` };
  }
  revalidatePath("/entregas/flete");
  return { ok: true, done, msg: `Ubiqué ${found}${missing ? ` · ${missing} sin encontrar (poné los km a mano)` : ""}` };
}
