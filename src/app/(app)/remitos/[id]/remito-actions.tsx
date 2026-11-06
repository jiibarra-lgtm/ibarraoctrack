"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Ban, CheckCircle2, FileSignature, Loader2, MessageSquarePlus, Printer } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTrigger } from "@/components/ui/overlays";
import { Textarea } from "@/components/ui/primitives";
import { uploadPrivate } from "@/lib/upload";
import { attachSignedRemito, remitoAction } from "../actions";

export function RemitoActions({ id, orgId, status, canEdit }: { id: string; orgId: string; status: string; canEdit: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState<string | null>(null);
  const file = React.useRef<HTMLInputElement>(null);
  const voided = status === "anulado";

  const run = async (k: "entregado") => {
    setBusy(k);
    const r = await remitoAction(id, k);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    toast.success("Remito marcado como entregado");
    router.refresh();
  };

  const onSigned = async (fl: FileList | null) => {
    const f = fl?.[0];
    if (!f) return;
    setBusy("firmado");
    try {
      const up = await uploadPrivate(f, orgId, `remitos/${id}`);
      const r = await attachSignedRemito({ remitoId: id, storagePath: up.path, title: up.title, mimeType: up.mimeType as never, size: up.size, sha256: up.sha256 });
      if (!r.ok) toast.error(r.error);
      else { toast.success("Copia firmada guardada"); router.refresh(); }
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setBusy(null);
      if (file.current) file.current.value = "";
    }
  };

  return (
    <div className="flex flex-wrap gap-2">
      <Button asChild><a href={`/imprimir/remito/${id}`} target="_blank" rel="noreferrer"><Printer /> Imprimir / PDF</a></Button>
      {canEdit && !voided && (
        <>
          {status === "emitido" && <Button variant="secondary" onClick={() => run("entregado")} loading={busy === "entregado"}><CheckCircle2 /> Marcar entregado</Button>}
          <input ref={file} type="file" hidden accept="application/pdf,image/*" onChange={(e) => onSigned(e.target.files)} />
          <Button variant="secondary" onClick={() => file.current?.click()} disabled={busy === "firmado"}>
            {busy === "firmado" ? <Loader2 className="animate-spin" /> : <FileSignature />} {status === "firmado" ? "Reemplazar copia firmada" : "Subir copia firmada"}
          </Button>
          <NoteDialog id={id} kind="anulado" />
        </>
      )}
      {canEdit && <NoteDialog id={id} kind="nota" />}
    </div>
  );
}

function NoteDialog({ id, kind }: { id: string; kind: "anulado" | "nota" }) {
  const router = useRouter();
  const [open, setOpen] = React.useState(false);
  const [text, setText] = React.useState("");
  const [saving, setSaving] = React.useState(false);
  const save = async () => {
    setSaving(true);
    const r = await remitoAction(id, kind, text);
    setSaving(false);
    if (!r.ok) return toast.error(r.error);
    toast.success(kind === "anulado" ? "Remito anulado" : "Nota agregada");
    setOpen(false); setText("");
    router.refresh();
  };
  const voiding = kind === "anulado";
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button variant={voiding ? "ghost" : "ghost"} className={voiding ? "text-danger" : undefined}>{voiding ? <Ban /> : <MessageSquarePlus />} {voiding ? "Anular" : "Nota"}</Button>
      </DialogTrigger>
      <DialogContent title={voiding ? "Anular remito" : "Agregar nota"} description={voiding ? "El remito queda en el historial marcado como ANULADO (no se borra ni se reutiliza el número). Si registró una entrega en la orden, se cancela." : "Queda en el historial del remito con tu nombre y la hora."}>
        <Textarea value={text} onChange={(e) => setText(e.target.value)} rows={3} placeholder={voiding ? "Motivo de la anulación" : "Ej.: lo recibió Juan Pérez en farmacia"} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setOpen(false)}>Cancelar</Button>
          <Button onClick={save} loading={saving} disabled={!text.trim()} className={voiding ? "bg-danger text-white hover:bg-danger/90" : undefined}>{voiding ? "Anular remito" : "Guardar nota"}</Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
