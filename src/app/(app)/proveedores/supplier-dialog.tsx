"use client";
import * as React from "react";
import { useActionState } from "react";
import { toast } from "sonner";
import { Pencil, Plus } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Field, Input, NativeSelect, Textarea } from "@/components/ui/primitives";
import { saveSupplier } from "./actions";

type S = { id?: string; name?: string; cuit?: string | null; phone?: string | null; email?: string | null; address?: string | null; payment_terms?: string | null; notes?: string | null; rating?: number | null };

export function SupplierDialog({ supplier }: { supplier?: S }) {
  const [open, setOpen] = React.useState(false);
  const [, action, pending] = useActionState(async (prev: unknown, fd: FormData) => {
    const r = await saveSupplier(prev, fd);
    if (r && "ok" in r) { toast.success("Proveedor guardado"); setOpen(false); }
    else if (r?.error) toast.error(r.error);
    return r;
  }, null);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{supplier ? <Button variant="ghost" size="icon-sm" aria-label="Editar"><Pencil /></Button> : <Button><Plus /> Proveedor</Button>}</DialogTrigger>
      <DialogContent title={supplier ? "Editar proveedor" : "Nuevo proveedor"}>
        <form action={action} className="grid grid-cols-2 gap-3">
          <input type="hidden" name="id" value={supplier?.id ?? ""} />
          <Field label="Razón social" className="col-span-2"><Input name="name" defaultValue={supplier?.name ?? ""} required /></Field>
          <Field label="CUIT"><Input name="cuit" defaultValue={supplier?.cuit ?? ""} inputMode="numeric" /></Field>
          <Field label="Teléfono"><Input name="phone" defaultValue={supplier?.phone ?? ""} /></Field>
          <Field label="Email" className="col-span-2"><Input name="email" type="email" defaultValue={supplier?.email ?? ""} /></Field>
          <Field label="Dirección" className="col-span-2"><Input name="address" defaultValue={supplier?.address ?? ""} /></Field>
          <Field label="Condiciones de pago"><Input name="payment_terms" defaultValue={supplier?.payment_terms ?? ""} placeholder="30 días" /></Field>
          <Field label="Evaluación">
            <NativeSelect name="rating" defaultValue={supplier?.rating ? String(supplier.rating) : ""}>
              <option value="">Sin evaluar</option>{[5, 4, 3, 2, 1].map((r) => <option key={r} value={r}>{"★".repeat(r)}</option>)}
            </NativeSelect>
          </Field>
          <Field label="Observaciones" className="col-span-2"><Textarea name="notes" rows={2} defaultValue={supplier?.notes ?? ""} /></Field>
          <div className="col-span-2 flex justify-end gap-2"><Button type="button" variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button><Button type="submit" loading={pending}>Guardar</Button></div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
