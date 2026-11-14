"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Camera, CheckCircle2, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadPrivate } from "@/lib/upload";
import { compressPhoto } from "@/lib/image-compress";
import { attachSignedRemito } from "../actions";

/** Foto del remito firmado desde el celular: abre la cámara, achica la foto, la sube y marca el remito como firmado. */
export function PhotoButton({ id, orgId }: { id: string; orgId: string }) {
  const router = useRouter();
  const ref = React.useRef<HTMLInputElement>(null);
  const [state, setState] = React.useState<"idle" | "busy" | "done">("idle");
  const onFile = async (fl: FileList | null) => {
    const raw = fl?.[0];
    if (!raw) return;
    setState("busy");
    try {
      const f = await compressPhoto(raw);
      const up = await uploadPrivate(f, orgId, `remitos/${id}`);
      const r = await attachSignedRemito({ remitoId: id, storagePath: up.path, title: up.title, mimeType: up.mimeType as never, size: up.size, sha256: up.sha256 });
      if (!r.ok) { toast.error(r.error); setState("idle"); return; }
      toast.success("Remito firmado guardado");
      setState("done");
      router.refresh();
    } catch (e) {
      toast.error((e as Error).message);
      setState("idle");
    } finally {
      if (ref.current) ref.current.value = "";
    }
  };
  return (
    <>
      <input ref={ref} type="file" hidden accept="image/*,application/pdf" capture="environment" onChange={(e) => onFile(e.target.files)} />
      <Button size="sm" variant={state === "done" ? "ghost" : "secondary"} onClick={() => ref.current?.click()} disabled={state !== "idle"} className="shrink-0">
        {state === "busy" ? <Loader2 className="animate-spin" /> : state === "done" ? <CheckCircle2 className="text-success" /> : <Camera />}
        {state === "done" ? "Guardado" : "Foto firmada"}
      </Button>
    </>
  );
}
