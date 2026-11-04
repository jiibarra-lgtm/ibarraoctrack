"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Field, Input } from "@/components/ui/primitives";

/** Anulación con motivo obligatorio (nada se borra: queda registrado). */
export function VoidDialog({ title, description, trigger, action }: {
  title: string; description: string; trigger: React.ReactNode; action: (reason: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [reason, setReason] = React.useState("");
  const [busy, setBusy] = React.useState(false);
  const go = async () => {
    setBusy(true);
    const r = await action(reason);
    setBusy(false);
    if (!r.ok) return toast.error(r.error ?? "No se pudo anular");
    toast.success("Anulado");
    setOpen(false);
    setReason("");
    router.refresh();
  };
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>{trigger}</DialogTrigger>
      <DialogContent title={title} description={description}>
        <Field label="Motivo" htmlFor="void-reason">
          <Input id="void-reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="Ej.: número mal cargado" autoFocus />
        </Field>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button variant="danger" onClick={go} loading={busy} disabled={reason.trim().length < 3}>Anular</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
