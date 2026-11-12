"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { emitCreditNote } from "@/app/(app)/facturacion/einvoice-actions";

/** Anula una factura electrónica emitiendo la nota de crédito por el total. */
export function CreditNoteButton({ id, label, total }: { id: string; label: string; total: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [busy, setBusy] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><button type="button" className="text-xs text-fg-subtle hover:text-danger">Anular</button></DialogTrigger>
      <DialogContent title={`Anular ${label}`} description={`Se emite una nota de crédito por ${total} con los mismos renglones y se pide el CAE a ARCA. Si la factura es de una OC, queda anulada en su facturación.`}>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" disabled={busy} onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="danger" loading={busy} onClick={async () => {
            setBusy(true);
            const r = await emitCreditNote(id);
            setBusy(false);
            if (!r.ok) { toast.error(r.error, { duration: 12000 }); return; }
            toast.success(`${r.label} emitida · CAE ${r.cae}`);
            setOpen(false);
            router.refresh();
            window.open(`/imprimir/factura/${r.id}`, "_blank");
          }}>Emitir nota de crédito</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
