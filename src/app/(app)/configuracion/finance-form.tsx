"use client";
import { useActionState, useEffect } from "react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Field, Input, NativeSelect } from "@/components/ui/primitives";
import { updateFinancialSettings } from "./actions";

type FS = { vat_recoverable: boolean; sales_include_vat: boolean; default_vat_rate: string; min_margin_pct: string; default_allocation: string; collection_days?: number | string };

export function FinanceForm({ fs, editable }: { fs: FS; editable: boolean }) {
  const [state, action, pending] = useActionState(updateFinancialSettings, null);
  useEffect(() => {
    if (state?.ok) toast.success("Configuración guardada");
    if (state?.error) toast.error(state.error);
  }, [state]);
  return (
    <form action={action} className="grid grid-cols-2 gap-4">
      <Field label="IVA de compras" className="col-span-2" hint="Responsable Inscripto: se recupera y el costo se toma neto">
        <NativeSelect name="vat_recoverable" defaultValue={fs.vat_recoverable ? "si" : "no"} disabled={!editable}>
          <option value="si">Recuperable (costo sin IVA)</option><option value="no">No recuperable (costo con IVA)</option>
        </NativeSelect>
      </Field>
      <Field label="Precios de las OC" className="col-span-2">
        <NativeSelect name="sales_include_vat" defaultValue={fs.sales_include_vat ? "si" : "no"} disabled={!editable}>
          <option value="si">Incluyen IVA (se descuenta para calcular la venta neta)</option><option value="no">Son netos de IVA</option>
        </NativeSelect>
      </Field>
      <Field label="Alícuota IVA ventas %"><Input name="default_vat_rate" defaultValue={Number(fs.default_vat_rate)} inputMode="decimal" disabled={!editable} /></Field>
      <Field label="Margen mínimo %" hint="Debajo de esto la orden se marca"><Input name="min_margin_pct" defaultValue={Number(fs.min_margin_pct)} inputMode="decimal" disabled={!editable} /></Field>
      <Field label="Días de cobro" hint="Vencimiento de las facturas emitidas"><Input name="collection_days" defaultValue={Number(fs.collection_days ?? 30)} inputMode="numeric" disabled={!editable} /></Field>
      <Field label="Reparto de gastos compartidos" className="col-span-2">
        <NativeSelect name="default_allocation" defaultValue={fs.default_allocation} disabled={!editable}>
          <option value="importe">Proporcional al importe de cada orden</option><option value="unidades">Proporcional a las unidades</option>
        </NativeSelect>
      </Field>
      {editable && <Button type="submit" loading={pending} className="col-span-2 justify-self-start">Guardar</Button>}
    </form>
  );
}
