"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Field, Textarea } from "@/components/ui/primitives";
import { voidPurchase } from "../actions";

export function VoidButton({ id }: { id: string }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [loading, setLoading] = React.useState(false);
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild><Button variant="secondary"><Ban /> Anular</Button></DialogTrigger>
      <DialogContent title="Anular compra" description="Deja de contar como costo en las órdenes. El registro queda en el historial.">
        <Field label="Motivo"><Textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={3} /></Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="danger" loading={loading} disabled={!reason.trim()} onClick={async () => {
            setLoading(true);
            const r = await voidPurchase(id, reason);
            setLoading(false);
            if (!r.ok) return toast.error(r.error);
            setOpen(false); router.refresh();
          }}>Anular</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
