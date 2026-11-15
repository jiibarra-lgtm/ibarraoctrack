"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hideSupplierInvoice, uploadSupplierInvoices } from "./actions";
import { compressPhoto } from "@/lib/image-compress";

export function UploadInvoices() {
  const router = useRouter();
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <>
      <input ref={ref} type="file" accept="application/pdf,.pdf,image/*" multiple hidden
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []).slice(0, 20);
          e.target.value = "";
          if (!files.length) return;
          setBusy(true);
          // De a una por vez: las fotos se achican antes de subir y se leen con OCR en el servidor
          const ok: string[] = [], bad: string[] = [];
          for (const raw of files) {
            const f = raw.type.startsWith("image/") ? await compressPhoto(raw, 2600, 0.85).catch(() => raw) : raw;
            const fd = new FormData();
            fd.append("files", f, raw.name);
            const r = await uploadSupplierInvoices(fd).catch((err: Error) => ({ ok: false as const, error: `${raw.name}: ${err.message}` }));
            if (r.ok) ok.push(r.message); else bad.push(r.error);
          }
          setBusy(false);
          if (ok.length) toast.success(ok.join(" · "));
          if (bad.length) toast.error(bad.join(" · "), { duration: 12000 });
          router.refresh();
        }} />
      <Button variant="secondary" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Subir facturas (PDF o foto)
      </Button>
    </>
  );
}

export function HideInvoice({ id, hidden }: { id: string; hidden: boolean }) {
  const router = useRouter();
  return (
    <button type="button" title={hidden ? "Volver a mostrar" : "Ocultar (mal leída o no es una compra)"} className="text-fg-subtle hover:text-fg"
      onClick={async () => { const r = await hideSupplierInvoice(id, !hidden); if (r.ok) { toast.success(r.message); router.refresh(); } else toast.error(r.error); }}>
      {hidden ? <Eye className="size-3.5" /> : <EyeOff className="size-3.5" />}
    </button>
  );
}
