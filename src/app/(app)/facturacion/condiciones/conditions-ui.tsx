"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Pencil, Plus, Star } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/primitives";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { CONCEPTS, IVA_CONDITIONS, PAYMENT_KINDS, type EInvoiceSettings, type PaymentKind, type SaleCondition } from "@/lib/einvoice";
import { saveEInvoiceSettings, saveSaleCondition, setCustomerCondition, setDefaultCondition, toggleCondition } from "./actions";

/** Alta / edición de una condición de venta. */
export function ConditionEditor({ row, nextCode }: { row?: SaleCondition; nextCode: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [code, setCode] = React.useState(String(row?.code ?? nextCode));
  const [name, setName] = React.useState(row?.name ?? "");
  const [kind, setKind] = React.useState<PaymentKind>(row?.arca_kind ?? "cuenta_corriente");
  const [days, setDays] = React.useState(row?.days.join(", ") ?? "");
  const [notes, setNotes] = React.useState(row?.notes ?? "");
  const [busy, setBusy] = React.useState(false);
  const parsedDays = days.split(/[\s,;/]+/).filter(Boolean).map(Number);
  const daysOk = parsedDays.every((d) => Number.isInteger(d) && d >= 0 && d <= 720);
  const save = async () => {
    setBusy(true);
    const r = await saveSaleCondition({ id: row?.id ?? null, code: Number(code), name, arca_kind: kind, days: parsedDays, notes: notes || null });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(row ? "Condición actualizada" : "Condición creada");
    setOpen(false);
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{row ? <Button size="sm" variant="ghost"><Pencil className="size-3.5" /> Editar</Button> : <Button><Plus /> Nueva condición</Button>}</DialogTrigger>
      <DialogContent title={row ? `Condición ${row.code}` : "Nueva condición de venta"} description="Lo que sale impreso en la factura y cuándo vence el cobro.">
        <div className="grid gap-3 sm:grid-cols-[90px_1fr]">
          <Field label="Código" htmlFor="sc-code"><Input id="sc-code" value={code} inputMode="numeric" onChange={(e) => setCode(e.target.value.replace(/\D/g, ""))} /></Field>
          <Field label="Nombre" htmlFor="sc-name"><Input id="sc-name" value={name} maxLength={60} placeholder="Cuenta corriente 30 días" onChange={(e) => setName(e.target.value)} /></Field>
          <Field label="Tipo según ARCA" htmlFor="sc-kind" className="sm:col-span-2" hint={PAYMENT_KINDS[kind].electronic ? "Cuenta como cobro por medio electrónico" : "No cuenta como medio electrónico: por encima del tope hay que identificar al cliente"}>
            <NativeSelect id="sc-kind" value={kind} onChange={(e) => setKind(e.target.value as PaymentKind)}>
              {(Object.keys(PAYMENT_KINDS) as PaymentKind[]).map((k) => <option key={k} value={k}>{PAYMENT_KINDS[k].label}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Plazos en días" htmlFor="sc-days" className="sm:col-span-2" hint="Vacío = vence el día de la factura. Uno solo = un vencimiento (30). Varios = cuotas iguales (30, 60, 90).">
            <Input id="sc-days" value={days} placeholder="30" onChange={(e) => setDays(e.target.value)} invalid={!daysOk} />
          </Field>
          <Field label="Nota interna (opcional)" htmlFor="sc-notes" className="sm:col-span-2"><Input id="sc-notes" value={notes} maxLength={300} onChange={(e) => setNotes(e.target.value)} /></Field>
          <div className="flex justify-end gap-2 sm:col-span-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button loading={busy} disabled={!name.trim() || !code || !daysOk} onClick={save}>Guardar</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

export function ConditionButtons({ row }: { row: SaleCondition }) {
  const router = useRouter();
  const run = async (p: Promise<{ ok: boolean; error?: string }>, msg: string) => {
    const r = await p;
    if (!r.ok) return toast.error(r.error ?? "No se pudo");
    toast.success(msg);
    router.refresh();
  };
  return (
    <>
      {!row.is_default && row.active && <Button size="sm" variant="ghost" onClick={() => run(setDefaultCondition(row.id), `"${row.name}" es la predeterminada`)}><Star className="size-3.5" /> Predeterminada</Button>}
      {!row.is_default && <Button size="sm" variant="ghost" onClick={() => run(toggleCondition(row.id, !row.active), row.active ? "Desactivada" : "Activada")}>{row.active ? "Desactivar" : "Activar"}</Button>}
    </>
  );
}

export function CustomerConditionSelect({ customerId, value, options }: { customerId: string; value: string | null; options: { id: string; label: string }[] }) {
  const router = useRouter();
  const [v, setV] = React.useState(value ?? "");
  return (
    <NativeSelect className="h-8 w-full max-w-[260px]" value={v} onChange={async (e) => {
      const nv = e.target.value;
      setV(nv);
      const r = await setCustomerCondition(customerId, nv || null);
      if (!r.ok) { toast.error(r.error); setV(value ?? ""); } else { toast.success("Guardado"); router.refresh(); }
    }}>
      <option value="">La predeterminada</option>
      {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
    </NativeSelect>
  );
}

/** Datos fijos de facturación: así se completan siempre los casilleros de ARCA. */
export function EInvoiceSettingsForm({ initial, options, canEdit }: { initial: EInvoiceSettings | null; options: { id: string; label: string }[]; canEdit: boolean }) {
  const router = useRouter();
  const [v, setV] = React.useState<EInvoiceSettings>(initial ?? {
    fixed_receiver: true, receiver_cuit: "34999032089", receiver_name: "GOBIERNO DE LA CIUDAD DE BUENOS AIRES", receiver_address: "Belgrano 840, CABA",
    iva_condition: 4, sale_condition_id: null, concept: 1, require_remito: true, remito_pv: 1,
  });
  const [busy, setBusy] = React.useState(false);
  const set = <K extends keyof EInvoiceSettings>(k: K, x: EInvoiceSettings[K]) => setV((o) => ({ ...o, [k]: x }));
  const save = async () => {
    setBusy(true);
    const r = await saveEInvoiceSettings({ ...v, remito_pv: v.remito_pv || null });
    setBusy(false);
    if (!r.ok) return toast.error(r.error);
    toast.success("Datos de facturación guardados");
    router.refresh();
  };
  return (
    <div className="space-y-4 px-5 pb-5">
      <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={v.fixed_receiver} disabled={!canEdit} onChange={(e) => set("fixed_receiver", e.target.checked)} /> Facturar siempre a este receptor (no se puede cambiar al emitir)</label>
      <div className="grid gap-3 sm:grid-cols-2">
        <Field label="Condición frente al IVA" htmlFor="es-iva">
          <NativeSelect id="es-iva" value={v.iva_condition} disabled={!canEdit} onChange={(e) => set("iva_condition", Number(e.target.value))}>
            {Object.entries(IVA_CONDITIONS).map(([k, c]) => <option key={k} value={k}>{c.label} (Factura {c.letter})</option>)}
          </NativeSelect>
        </Field>
        <Field label="CUIT" htmlFor="es-cuit"><Input id="es-cuit" value={v.receiver_cuit} disabled={!canEdit} className="tabular" onChange={(e) => set("receiver_cuit", e.target.value)} /></Field>
        <Field label="Apellido y nombre o razón social" htmlFor="es-name"><Input id="es-name" value={v.receiver_name} disabled={!canEdit} onChange={(e) => set("receiver_name", e.target.value)} /></Field>
        <Field label="Domicilio comercial" htmlFor="es-addr"><Input id="es-addr" value={v.receiver_address ?? ""} disabled={!canEdit} onChange={(e) => set("receiver_address", e.target.value)} /></Field>
        <Field label="Condición de venta" htmlFor="es-cond">
          <NativeSelect id="es-cond" value={v.sale_condition_id ?? ""} disabled={!canEdit} onChange={(e) => set("sale_condition_id", e.target.value || null)}>
            <option value="">La predeterminada</option>
            {options.map((o) => <option key={o.id} value={o.id}>{o.label}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Conceptos a incluir" htmlFor="es-concept">
          <NativeSelect id="es-concept" value={v.concept} disabled={!canEdit} onChange={(e) => set("concept", Number(e.target.value) as 1 | 2 | 3)}>
            {Object.entries(CONCEPTS).map(([k, c]) => <option key={k} value={k}>{c}</option>)}
          </NativeSelect>
        </Field>
        <Field label="Punto de venta de tus remitos R (se propone)" htmlFor="es-rpv"><Input id="es-rpv" value={v.remito_pv ?? ""} inputMode="numeric" disabled={!canEdit} className="tabular" onChange={(e) => set("remito_pv", Number(e.target.value.replace(/\D/g, "")) || null)} /></Field>
        <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={v.require_remito} disabled={!canEdit} onChange={(e) => set("require_remito", e.target.checked)} /> No dejar emitir sin el N° de remito oficial</label>
      </div>
      {canEdit && <div className="flex justify-end"><Button loading={busy} onClick={save}>Guardar</Button></div>}
    </div>
  );
}
