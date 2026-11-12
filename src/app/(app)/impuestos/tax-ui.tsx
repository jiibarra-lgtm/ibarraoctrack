"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Printer, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { parseArNumber } from "@/lib/money";
import { checkPadronNow, saveTaxSettings, syncEmittedNow } from "./tax-actions";

export function SyncEmittedButton() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button size="sm" variant="secondary" loading={busy} onClick={async () => {
      setBusy(true); const r = await syncEmittedNow(); setBusy(false);
      if (!r.ok) toast.error(r.error, { duration: 10000 }); else { toast.success(r.added ? `${r.added} comprobantes nuevos traídos de ARCA` : "Ya estaba todo al día"); router.refresh(); }
    }}>{!busy && <RefreshCw />} Traer emitidos de ARCA</Button>
  );
}

export function PadronButton() {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button size="sm" variant="secondary" loading={busy} onClick={async () => {
      setBusy(true); const r = await checkPadronNow(); setBusy(false);
      if (!r.ok) toast.error(r.error, { duration: 15000 }); else { toast.success("Padrón actualizado"); router.refresh(); }
    }}>{!busy && <RefreshCw />} Revisar padrón ahora</Button>
  );
}

export function PrintButton() {
  return <Button size="sm" variant="secondary" onClick={() => window.print()}><Printer /> Imprimir / PDF para el contador</Button>;
}

type S = { iibb_rate: number; iibb_day: number; autonomos: boolean; autonomos_day: number; gni: number; special_deduction: number; other_deductions: number; ganancias_paid: number };
const show = (n: number) => String(n).replace(".", ",");

export function TaxSettingsForm({ initial, disabled }: { initial: S; disabled: boolean }) {
  const router = useRouter();
  const [f, setF] = React.useState(() => Object.fromEntries(Object.entries(initial).map(([k, v]) => [k, typeof v === "boolean" ? v : show(v)])) as Record<keyof S, string | boolean>);
  const [busy, setBusy] = React.useState(false);
  const set = (k: keyof S) => (e: React.ChangeEvent<HTMLInputElement>) => setF((x) => ({ ...x, [k]: e.target.type === "checkbox" ? e.target.checked : e.target.value }));
  const n = (k: keyof S) => Number(parseArNumber(String(f[k])) ?? NaN);
  const save = async () => {
    setBusy(true);
    const r = await saveTaxSettings({
      iibb_rate: n("iibb_rate"), iibb_day: Math.round(n("iibb_day")), autonomos: Boolean(f.autonomos), autonomos_day: Math.round(n("autonomos_day")),
      gni: n("gni"), special_deduction: n("special_deduction"), other_deductions: n("other_deductions"), ganancias_paid: n("ganancias_paid"),
    });
    setBusy(false);
    if (!r.ok) toast.error(r.error); else { toast.success("Guardado"); router.refresh(); }
  };
  return (
    <div className="space-y-3 px-5 pb-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Alícuota de Ingresos Brutos (%)" htmlFor="ts-r"><Input id="ts-r" value={String(f.iibb_rate)} onChange={set("iibb_rate")} disabled={disabled} inputMode="decimal" /></Field>
        <Field label="Día de vencimiento de IIBB" htmlFor="ts-d"><Input id="ts-d" value={String(f.iibb_day)} onChange={set("iibb_day")} disabled={disabled} inputMode="numeric" /></Field>
        <Field label="Ganancia no imponible (anual)" htmlFor="ts-g"><Input id="ts-g" value={String(f.gni)} onChange={set("gni")} disabled={disabled} inputMode="decimal" /></Field>
        <Field label="Deducción especial (anual)" htmlFor="ts-e"><Input id="ts-e" value={String(f.special_deduction)} onChange={set("special_deduction")} disabled={disabled} inputMode="decimal" /></Field>
        <Field label="Otras deducciones (cargas de familia, prepaga…)" htmlFor="ts-o"><Input id="ts-o" value={String(f.other_deductions)} onChange={set("other_deductions")} disabled={disabled} inputMode="decimal" /></Field>
        <Field label="Anticipos de Ganancias ya pagados este año" htmlFor="ts-p"><Input id="ts-p" value={String(f.ganancias_paid)} onChange={set("ganancias_paid")} disabled={disabled} inputMode="decimal" /></Field>
      </div>
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={Boolean(f.autonomos)} onChange={set("autonomos")} disabled={disabled} /> Pago aportes de autónomos (día
        <input value={String(f.autonomos_day)} onChange={set("autonomos_day")} disabled={disabled} className="w-10 rounded border border-card-border bg-field px-1 text-center" />)</label>
      {!disabled && <div className="flex justify-end"><Button size="sm" loading={busy} onClick={save}>Guardar</Button></div>}
    </div>
  );
}
