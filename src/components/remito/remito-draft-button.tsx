"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { emitRemito, type EmitPayload } from "@/app/(app)/remitos/actions";

export function EmitDraftButton({ payload }: { payload: EmitPayload }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const [confirm, setConfirm] = React.useState(false);
  if (!confirm) return <Button onClick={() => setConfirm(true)}><Send /> Emitir tal cual</Button>;
  return (
    <span className="inline-flex flex-wrap items-center gap-2 rounded-xl border border-card-border bg-field px-3 py-1.5 text-sm">
      Se emite como provisorio y se registra la entrega de lo pendiente.
      <Button size="sm" disabled={busy} onClick={async () => {
        setBusy(true);
        const r = await emitRemito(payload);
        setBusy(false);
        if (!r.ok) return toast.error(r.error);
        toast.success("Remito emitido");
        router.push(`/remitos/${r.id}?nuevo=1`);
      }}>{busy ? "Emitiendo…" : "Confirmar"}</Button>
      <Button size="sm" variant="ghost" onClick={() => setConfirm(false)}>Cancelar</Button>
    </span>
  );
}
