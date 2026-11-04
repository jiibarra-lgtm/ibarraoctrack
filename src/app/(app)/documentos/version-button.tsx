"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { History } from "lucide-react";
import { Button } from "@/components/ui/button";
import { uploadPrivate } from "@/lib/upload";
import { uploadNewVersion } from "./actions";

export function VersionButton({ documentId, orgId }: { documentId: string; orgId: string }) {
  const router = useRouter();
  const ref = React.useRef<HTMLInputElement>(null);
  const [busy, setBusy] = React.useState(false);
  return (
    <>
      <input ref={ref} type="file" hidden accept="application/pdf,image/*" onChange={async (e) => {
        const f = e.target.files?.[0]; e.target.value = "";
        if (!f) return;
        setBusy(true);
        try {
          const up = await uploadPrivate(f, orgId, `versiones/${documentId}`);
          const r = await uploadNewVersion({ documentId, storagePath: up.path, mimeType: up.mimeType as never, size: up.size, sha256: up.sha256 });
          if (!r.ok) throw new Error(r.error);
          toast.success("Nueva versión guardada");
          router.refresh();
        } catch (err) { toast.error((err as Error).message); }
        setBusy(false);
      }} />
      <Button variant="ghost" size="icon-sm" loading={busy} onClick={() => ref.current?.click()} aria-label="Subir nueva versión" title="Subir nueva versión">{!busy && <History />}</Button>
    </>
  );
}
