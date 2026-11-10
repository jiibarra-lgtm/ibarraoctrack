"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Eye, EyeOff, Loader2, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { hideSupplierInvoice, uploadSupplierInvoices } from "./actions";

export function UploadInvoices() {
  const router = useRouter();
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <>
      <input ref={ref} type="file" accept="application/pdf,.pdf" multiple hidden
        onChange={async (e) => {
          const files = Array.from(e.target.files ?? []);
          e.target.value = "";
          if (!files.length) return;
          const fd = new FormData();
          files.forEach((f) => fd.append("files", f));
          setBusy(true);
          const r = await uploadSupplierInvoices(fd);
          setBusy(false);
          if (r.ok) { toast.success(r.message); router.refresh(); } else toast.error(r.error);
        }} />
      <Button variant="secondary" disabled={busy} onClick={() => ref.current?.click()}>
        {busy ? <Loader2 className="size-4 animate-spin" /> : <Upload className="size-4" />} Subir facturas PDF
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
