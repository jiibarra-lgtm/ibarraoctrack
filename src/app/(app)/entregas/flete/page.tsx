import type { Metadata } from "next";
import Link from "next/link";
import { Fuel, Gauge, Route, Truck } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/session";
import { Badge, Card, CardHeader, PageHeader } from "@/components/ui/primitives";
import { Stat } from "@/components/ui/stat";
import { formatMoney } from "@/lib/format";
import { cn } from "@/lib/utils";
import { DEFAULT_FREIGHT, normPlace, roundTripKm, routeKm, tripCost, fuelLiters, type FreightSettings, type Pt } from "@/lib/freight";
import { LocateButton, ManualKm, SettingsForm } from "./ui";

export const metadata: Metadata = { title: "Costo de flete" };
export const maxDuration = 60;

type Item = { id: string; place: string; address: string | null; status: string; delivered_on: string | null; oc_refs: string[]; orders: { id: string; number: string }[] };
type Geo = { query: string; lat: number | null; lng: number | null; status: string; km_manual: number | null };

const daysSince = (iso: string) => Math.round((Date.now() - Date.parse(iso)) / 864e5);
const monthLabel = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("es-AR", { month: "long", year: "numeric" });
const pct = (a: number, b: number) => (b > 0 ? `${((a / b) * 100).toLocaleString("es-AR", { maximumFractionDigits: 1 })}%` : "—");

export default async function FreightPage({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const sp = await searchParams;
  const s = await requireOrg();
  const org = s.org.org_id;
  const canEdit = canWrite(s.org.role) || s.org.role === "logistica";
  const [{ data: setRow }, { data: items }, { data: geo }, { data: costs }] = await Promise.all([
    s.supabase.from("freight_settings").select("*").eq("org_id", org).maybeSingle(),
    s.supabase.from("delivery_board_overview").select("id, place, address, status, delivered_on, oc_refs, orders").eq("org_id", org).limit(3000),
    s.supabase.from("geo_places").select("query, lat, lng, status, km_manual").eq("org_id", org).limit(5000),
    s.supabase.from("fixed_costs").select("id, name, category, amount, frequency, active").eq("org_id", org).eq("active", true).order("name"),
  ]);
  const st: FreightSettings = setRow ? {
    ...DEFAULT_FREIGHT, ...setRow,
    consumption_l100: Number(setRow.consumption_l100), fuel_price: Number(setRow.fuel_price), extra_per_km: Number(setRow.extra_per_km), road_factor: Number(setRow.road_factor),
  } as FreightSettings : DEFAULT_FREIGHT;
  const all = (items ?? []) as Item[];
  const geoBy = new Map(((geo ?? []) as Geo[]).map((g) => [g.query, g]));
  const keyOf = (i: Item) => normPlace(i.address?.trim() ? i.address : i.place);
  const originG = geoBy.get(normPlace(st.origin_address));
  const origin: Pt | null = originG?.lat != null ? { lat: Number(originG.lat), lng: Number(originG.lng) } : null;
  const ptOf = (i: Item): Pt | null => { const g = geoBy.get(keyOf(i)); return g?.lat != null ? { lat: Number(g.lat), lng: Number(g.lng) } : null; };
  const manualOf = (i: Item) => { const g = geoBy.get(keyOf(i)); return g?.km_manual != null ? Number(g.km_manual) : null; };
  const kmAlone = (i: Item) => { const m = manualOf(i); if (m != null) return m; const p = ptOf(i); return origin && p ? roundTripKm(origin, p, st.road_factor) : null; };

  // Direcciones a ubicar (la de salida primero)
  const toLocate = new Map<string, { query: string; fallback?: string }>();
  if (!originG) toLocate.set(normPlace(st.origin_address), { query: st.origin_address });
  for (const i of all) { const k = keyOf(i); if (!geoBy.has(k) && !toLocate.has(k)) toLocate.set(k, { query: i.address?.trim() || i.place, fallback: i.place }); }
  const notFound = [...new Map(all.filter((i) => geoBy.get(keyOf(i))?.status === "no_encontrada").map((i) => [keyOf(i), i])).values()];

  // Gastos fijos de la camioneta y gasoil real, por mes
  const costList = ((costs ?? []) as { id: string; name: string; category: string; amount: string; frequency: number }[]);
  const delivered = all.filter((i) => i.status === "entregado" && i.delivered_on);
  const months = [...new Set(delivered.map((i) => i.delivered_on!.slice(0, 7)))].sort().reverse();
  const mes = sp.mes && months.includes(sp.mes) ? sp.mes : months[0];
  const next = mes ? new Date(Date.parse(`${mes}-01T12:00:00Z`) + 32 * 864e5).toISOString().slice(0, 7) : null;
  const { data: bills } = mes ? await s.supabase.from("fixed_cost_bills").select("cost_id, amount").eq("org_id", org).eq("period", mes) : { data: [] };
  const billSum = (ids: string[]) => ids.reduce((a, id) => {
    const bs = ((bills ?? []) as { cost_id: string; amount: string | null }[]).filter((b) => b.cost_id === id);
    if (bs.length) return a + bs.reduce((x, b) => x + Number(b.amount ?? 0), 0);
    const c = costList.find((c) => c.id === id);
    return a + (c ? Number(c.amount) / c.frequency : 0);
  }, 0);
  const vehicleFixed = st.share_vehicle_fixed ? billSum(st.vehicle_cost_ids) : 0;
  const realFuel = st.fuel_cost_ids.length ? billSum(st.fuel_cost_ids) : null;

  // Viajes del mes: un viaje por día con todas las paradas
  const monthItems = mes ? delivered.filter((i) => i.delivered_on!.startsWith(mes)) : [];
  const byDay = new Map<string, Item[]>();
  monthItems.forEach((i) => byDay.set(i.delivered_on!, [...(byDay.get(i.delivered_on!) ?? []), i]));
  const trips = [...byDay].sort((a, b) => b[0].localeCompare(a[0])).map(([day, list]) => {
    const pts = list.map(ptOf).filter(Boolean) as Pt[];
    const manual = list.filter((i) => manualOf(i) != null && !ptOf(i)).reduce((a, i) => a + manualOf(i)!, 0);
    const unknown = list.filter((i) => !ptOf(i) && manualOf(i) == null).length;
    const km = Math.round(((origin && pts.length ? routeKm(origin, pts, st.road_factor).km : 0) + manual) * 10) / 10;
    return { day, list, km, unknown, cost: tripCost(km, st) };
  });
  const tripsN = trips.length;
  const fixedPerTrip = tripsN ? vehicleFixed / tripsN : 0;
  const monthKm = trips.reduce((a, t) => a + t.km, 0);
  const monthVar = trips.reduce((a, t) => a + t.cost, 0);
  const monthTotal = monthVar + vehicleFixed;
  const perDelivery = monthItems.length ? monthTotal / monthItems.length : 0;
  const estFuel = Math.round(fuelLiters(monthKm, st) * st.fuel_price);

  // Valor de las OC para ver cuánto pesa el flete
  const orderIds = [...new Set(all.flatMap((i) => i.orders.map((o) => o.id)))];
  const { data: poRows } = orderIds.length ? await s.supabase.from("purchase_orders").select("id, total_amount").in("id", orderIds) : { data: [] };
  const poTotal = new Map(((poRows ?? []) as { id: string; total_amount: string }[]).map((p) => [p.id, Number(p.total_amount)]));
  const itemValue = (i: Item) => i.orders.reduce((a, o) => a + (poTotal.get(o.id) ?? 0), 0);

  // Pendientes: costo si la llevás sola, y el recorrido de todas juntas
  const pending = all.filter((i) => i.status === "pendiente");
  const pendRows = pending.map((i) => { const km = kmAlone(i); const cost = km != null ? tripCost(km, st) + fixedPerTrip : null; return { i, km, cost, value: itemValue(i) }; })
    .sort((a, b) => (b.cost ?? 0) / Math.max(b.value, 1) - (a.cost ?? 0) / Math.max(a.value, 1));
  const pendPts = pending.map(ptOf).filter(Boolean) as Pt[];
  const together = origin && pendPts.length ? routeKm(origin, pendPts, st.road_factor).km : 0;
  const separate = pendRows.reduce((a, r) => a + (r.km ?? 0), 0);

  const fuelAge = daysSince(st.fuel_price_on);
  const fuelCandidates = costList.filter((c) => !st.fuel_cost_ids.length && /ROAL|YPF|SHELL|AXION|PUMA|GULF|COMBUST|ESTACION/i.test(c.name));

  return (
    <>
      <PageHeader title="Costo de flete" description={`${st.vehicle_name}: ${String(st.consumption_l100).replace(".", ",")} l/100 km · gasoil ${formatMoney(st.fuel_price)} el litro. Cada entrega con su costo, para sumarlo al precio.`}
        actions={toLocate.size > 0 && canEdit ? <LocateButton places={[...toLocate.values()]} /> : undefined} />

      {!origin && (
        <Card className="mb-4 border-warn/40 bg-warn/5 px-5 py-4 text-sm">
          Para calcular los kilómetros tengo que ubicar en el mapa el depósito y las direcciones de entrega. Tocá <b>Ubicar direcciones</b> (una sola vez; las nuevas se agregan solas cuando vuelvas a tocar).
        </Card>
      )}

      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat icon={Truck} label={`Costo por entrega · ${mes ? monthLabel(mes) : "—"}`} value={formatMoney(perDelivery)} sub={`${monthItems.length} entregas en ${tripsN} viajes`} />
        <Stat icon={Route} label="Km del mes (estimado)" value={`${Math.round(monthKm).toLocaleString("es-AR")} km`} sub={`${fuelLiters(monthKm, st).toFixed(0)} litros de gasoil`} />
        <Stat icon={Fuel} label="Gasoil estimado vs real" value={formatMoney(estFuel)} sub={realFuel != null ? `real cargado: ${formatMoney(realFuel)} (${pct(estFuel, realFuel)} lo explican las entregas)` : "marcá abajo cuál es tu gasoil para compararlo"} tone={realFuel != null && realFuel > estFuel * 1.5 ? "warn" : undefined} />
        <Stat icon={Gauge} label="Gastos fijos de la camioneta" value={formatMoney(vehicleFixed)} sub={tripsN ? `${formatMoney(fixedPerTrip)} por viaje` : "sin viajes este mes"} />
      </div>
      {fuelAge > 30 && <p className="mt-2 text-xs text-warn">El precio del gasoil se cargó hace {fuelAge} días: actualizalo abajo para que el cálculo no quede viejo.</p>}

      {months.length > 1 && (
        <nav className="mt-4 flex gap-1 overflow-x-auto">
          {months.slice(0, 8).map((m) => (
            <Link key={m} href={`/entregas/flete?mes=${m}`} className={cn("whitespace-nowrap rounded-full px-3 py-1 text-sm capitalize", m === mes ? "bg-primary text-primary-fg" : "text-fg-muted hover:bg-surface-2")}>{monthLabel(m)}</Link>
          ))}
        </nav>
      )}

      <div className="mt-4 grid gap-5 xl:grid-cols-2">
        <Card className="overflow-hidden">
          <CardHeader title="Pendientes: cuánto cuesta llevar cada una" description={pendPts.length > 1 ? `Si las llevás todas juntas: ${Math.round(together)} km en vez de ${Math.round(separate)} km una por una (ahorrás ${formatMoney(tripCost(Math.max(0, separate - together), st))}).` : "Costo de ir y volver, más la parte de gastos fijos de un viaje."} />
          <ul className="max-h-[520px] divide-y divide-border overflow-y-auto">
            {pendRows.map(({ i, km, cost, value }) => (
              <li key={i.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                <div className="min-w-0">
                  <p className="truncate font-medium">{i.place}</p>
                  <p className="truncate text-xs text-fg-subtle">{i.address}{i.orders.length ? ` · OC ${i.orders.map((o) => o.number).join(", ")}` : ""}</p>
                </div>
                <div className="shrink-0 text-right tabular">
                  {cost != null ? <><p className="font-semibold">{formatMoney(cost)}</p><p className={cn("text-[11px]", value && cost / value > 0.05 ? "font-medium text-danger" : "text-fg-subtle")}>{km} km{value ? ` · ${pct(cost, value)} de la OC` : ""}</p></>
                    : <span className="text-xs text-fg-subtle">falta ubicarla</span>}
                </div>
              </li>
            ))}
            {!pendRows.length && <li className="px-5 py-4 text-sm text-fg-muted">No hay entregas pendientes.</li>}
          </ul>
        </Card>

        <Card className="overflow-hidden">
          <CardHeader title={`Viajes de ${mes ? monthLabel(mes) : "—"}`} description="Un viaje por día con todas las entregas de ese día, en el orden más corto." />
          <ul className="max-h-[520px] divide-y divide-border overflow-y-auto">
            {trips.map((t) => {
              const total = t.cost + fixedPerTrip;
              const value = t.list.reduce((a, i) => a + itemValue(i), 0);
              return (
                <li key={t.day} className="px-5 py-2.5 text-sm">
                  <div className="flex items-baseline justify-between gap-3">
                    <p className="font-medium capitalize">{new Date(`${t.day}T12:00:00Z`).toLocaleDateString("es-AR", { weekday: "short", day: "numeric", month: "short" })} · {t.list.length} {t.list.length === 1 ? "entrega" : "entregas"}</p>
                    <p className="shrink-0 font-semibold tabular">{formatMoney(total)}</p>
                  </div>
                  <p className="text-xs text-fg-subtle">{t.km} km · {formatMoney(Math.round(total / t.list.length))} por entrega{value ? ` · ${pct(total, value)} de lo entregado` : ""}{t.unknown ? ` · ${t.unknown} sin ubicar` : ""}</p>
                  <p className="mt-0.5 truncate text-xs text-fg-muted">{t.list.map((i) => i.place).join(" → ")}</p>
                </li>
              );
            })}
            {!trips.length && <li className="px-5 py-4 text-sm text-fg-muted">Sin entregas registradas este mes.</li>}
          </ul>
        </Card>
      </div>

      {notFound.length > 0 && (
        <Card className="mt-5 overflow-hidden">
          <CardHeader title="No las encontré en el mapa" description="Poné los km de ida y vuelta a mano (o corregí la dirección en la entrega)." />
          <ul className="divide-y divide-border">
            {notFound.map((i) => (
              <li key={i.id} className="flex flex-wrap items-center justify-between gap-2 px-5 py-2 text-sm">
                <span className="min-w-0"><span className="font-medium">{i.place}</span> <span className="text-fg-subtle">· {i.address || "sin dirección"}</span></span>
                {canEdit && <ManualKm query={keyOf(i)} km={manualOf(i)} />}
              </li>
            ))}
          </ul>
        </Card>
      )}

      <Card className="mt-5">
        <CardHeader title="Camioneta y gasoil" description={fuelCandidates.length ? `¿${fuelCandidates.map((c) => c.name).join(", ")} es donde cargás gasoil? Marcalo para comparar lo real con lo estimado.` : "Cambiá los datos y se recalcula todo."} />
        <SettingsForm initial={st} canEdit={canEdit} costs={costList.map((c) => ({ id: c.id, name: c.name, category: c.category, month: Number(c.amount) / c.frequency }))} />
      </Card>
      {mes && next && <p className="mt-3 text-xs text-fg-subtle">Fuente del precio del gasoil por defecto: YPF Diesel 500, noviembre 2026. Las distancias salen de OpenStreetMap (línea recta × factor de calle). <Badge>Estimado</Badge></p>}
    </>
  );
}
