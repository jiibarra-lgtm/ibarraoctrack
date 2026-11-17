"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { MapPinned, Save } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { safeAction } from "@/lib/safe-action";
import type { FreightSettings } from "@/lib/freight";
import { locatePlaces, saveFreightSettings, setManualKm } from "./actions";

const n = (v: string) => Number(String(v).replace(/\./g, "").replace(",", "."));

export function SettingsForm({ initial, costs, canEdit }: { initial: FreightSettings; costs: { id: string; name: string; category: string; month: number }[]; canEdit: boolean }) {
  const router = useRouter();
  const [f, setF] = React.useState({
    origin_address: initial.origin_address, vehicle_name: initial.vehicle_name,
    consumption_l100: String(initial.consumption_l100).replace(".", ","), fuel_price: String(initial.fuel_price).replace(".", ","),
    extra_per_km: String(initial.extra_per_km).replace(".", ","), road_factor: String(initial.road_factor).replace(".", ","),
    share_vehicle_fixed: initial.share_vehicle_fixed, fuel: new Set(initial.fuel_cost_ids), vehicle: new Set(initial.vehicle_cost_ids),
  });
  const [busy, setBusy] = React.useState(false);
  const toggle = (k: "fuel" | "vehicle", id: string) => setF((x) => { const s = new Set(x[k]); if (s.has(id)) s.delete(id); else s.add(id); return { ...x, [k]: s }; });
  const save = async () => {
    setBusy(true);
    const r = await safeAction(() => saveFreightSettings({
      origin_address: f.origin_address, vehicle_name: f.vehicle_name, consumption_l100: n(f.consumption_l100), fuel_price: n(f.fuel_price),
      extra_per_km: n(f.extra_per_km || "0"), road_factor: n(f.road_factor), share_vehicle_fixed: f.share_vehicle_fixed,
      fuel_cost_ids: [...f.fuel], vehicle_cost_ids: [...f.vehicle],
    }));
    setBusy(false);
    if (!r.ok) { if (r.error) toast.error(r.error); return; }
    toast.success("Guardado: los costos se recalcularon");
    router.refresh();
  };
  return (
    <div className="grid gap-4 px-5 pb-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Vehículo"><Input value={f.vehicle_name} disabled={!canEdit} onChange={(e) => setF({ ...f, vehicle_name: e.target.value })} /></Field>
        <Field label="Sale desde"><Input value={f.origin_address} disabled={!canEdit} onChange={(e) => setF({ ...f, origin_address: e.target.value })} /></Field>
        <Field label="Consumo (litros cada 100 km)" hint="Sprinter 411 cargada en ciudad: 11 a 13"><Input inputMode="decimal" value={f.consumption_l100} disabled={!canEdit} onChange={(e) => setF({ ...f, consumption_l100: e.target.value })} /></Field>
        <Field label="Precio del gasoil por litro" hint="YPF Diesel 500, noviembre 2026: ~$2.469"><Input inputMode="decimal" value={f.fuel_price} disabled={!canEdit} onChange={(e) => setF({ ...f, fuel_price: e.target.value })} /></Field>
        <Field label="Desgaste por km (cubiertas, service, aceite)" hint="Opcional. Una Sprinter suele andar entre $80 y $150 por km"><Input inputMode="decimal" value={f.extra_per_km} disabled={!canEdit} onChange={(e) => setF({ ...f, extra_per_km: e.target.value })} /></Field>
        <Field label="Factor de calle" hint="Cuánto más largo es el recorrido real que la línea recta (ciudad: 1,3 a 1,4)"><Input inputMode="decimal" value={f.road_factor} disabled={!canEdit} onChange={(e) => setF({ ...f, road_factor: e.target.value })} /></Field>
      </div>
      {costs.length > 0 && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">¿Cuál es el gasoil que cargás? (para comparar con el real)</p>
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
              {costs.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canEdit} checked={f.fuel.has(c.id)} onChange={() => toggle("fuel", c.id)} className="size-4" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span></label>
              ))}
            </div>
          </div>
          <div>
            <p className="mb-1.5 text-xs font-medium text-fg-muted">Gastos fijos de la camioneta (peajes, seguro, patente) que se reparten entre los viajes</p>
            <div className="flex max-h-40 flex-col gap-1 overflow-y-auto rounded-lg border border-border p-2">
              {costs.map((c) => (
                <label key={c.id} className="flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canEdit} checked={f.vehicle.has(c.id)} onChange={() => toggle("vehicle", c.id)} className="size-4" />
                  <span className="min-w-0 flex-1 truncate">{c.name}</span></label>
              ))}
            </div>
            <label className="mt-2 flex items-center gap-2 text-sm"><input type="checkbox" disabled={!canEdit} checked={f.share_vehicle_fixed} onChange={(e) => setF({ ...f, share_vehicle_fixed: e.target.checked })} className="size-4" /> Sumarlos al costo de cada viaje</label>
          </div>
        </div>
      )}
      {canEdit && <div className="flex justify-end"><Button loading={busy} onClick={save}>{!busy && <Save />} Guardar y recalcular</Button></div>}
    </div>
  );
}

export function LocateButton({ places, label }: { places: { query: string; fallback?: string }[]; label?: string }) {
  const router = useRouter();
  const [prog, setProg] = React.useState<string | null>(null);
  if (!places.length) return null;
  const run = async () => {
    // de a 8 por llamada (cada una tarda hasta ~30 s); sigue sola hasta terminar
    for (let k = 0; k < places.length; k += 8) {
      setProg(`${k}/${places.length}`);
      const r = await safeAction(() => locatePlaces(places.slice(k, k + 8)));
      if (!r.ok) { if (r.error) toast.error(r.error); break; }
      router.refresh();
    }
    setProg(null);
    toast.success("Listo: direcciones ubicadas");
    router.refresh();
  };
  return (
    <Button variant="secondary" loading={!!prog} onClick={run}>{!prog && <MapPinned />} {prog ? `Ubicando ${prog}…` : label ?? `Ubicar ${places.length} direcciones`}</Button>
  );
}

export function ManualKm({ query, km }: { query: string; km: number | null }) {
  const router = useRouter();
  const [v, setV] = React.useState(km != null ? String(km).replace(".", ",") : "");
  const [busy, setBusy] = React.useState(false);
  return (
    <span className="inline-flex items-center gap-1">
      <Input value={v} onChange={(e) => setV(e.target.value)} placeholder="km ida y vuelta" inputMode="decimal" className="h-8 w-32 text-xs" />
      <Button size="sm" variant="ghost" loading={busy} onClick={async () => {
        setBusy(true);
        const r = await safeAction(() => setManualKm(query, v.trim() ? n(v) : null));
        setBusy(false);
        if (!r.ok) { if (r.error) toast.error(r.error); return; }
        toast.success("Guardado");
        router.refresh();
      }}>OK</Button>
    </span>
  );
}
