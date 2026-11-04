"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowRightLeft } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Field, NativeSelect, Textarea } from "@/components/ui/primitives";
import { PO_STATUSES, PO_STATUS_LABEL, type PoStatus } from "@/lib/po/schema";
import { setPurchaseOrderStatus } from "../actions";

export function StatusDialog({ id, status, version }: { id: string; status: PoStatus; version: number }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [next, setNext] = React.useState<PoStatus>(status);
  const [reason, setReason] = React.useState("");
  const [loading, setLoading] = React.useState(false);

  const submit = async () => {
    setLoading(true);
    const res = await setPurchaseOrderStatus(id, next, reason, version);
    setLoading(false);
    if (!res.ok) return toast.error(res.error);
    toast.success(`Estado: ${PO_STATUS_LABEL[next]}`);
    setOpen(false);
    setReason("");
    router.refresh();
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { setOpen(o); if (o) setNext(status); }}>
      <DialogTrigger asChild><Button variant="secondary"><ArrowRightLeft /> Estado</Button></DialogTrigger>
      <DialogContent title="Cambiar estado" description="El cambio queda registrado en el historial de la orden.">
        <div className="flex flex-col gap-4">
          <Field label="Nuevo estado">
            <NativeSelect value={next} onChange={(e) => setNext(e.target.value as PoStatus)}>
              {PO_STATUSES.map((s) => <option key={s} value={s}>{PO_STATUS_LABEL[s]}</option>)}
            </NativeSelect>
          </Field>
          <Field label={next === "anulada" ? "Motivo (obligatorio)" : "Motivo (opcional)"}>
            <Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} maxLength={500} />
          </Field>
          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
            <Button onClick={submit} loading={loading} disabled={next === status || (next === "anulada" && !reason.trim())} variant={next === "anulada" ? "danger" : "default"}>
              Confirmar
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
