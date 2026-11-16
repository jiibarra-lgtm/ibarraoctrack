"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { retryImport } from "@/app/(app)/ordenes/importar/actions";

/** Vuelve a leer el comprobante con el lector actual (descarta lo leído antes). */
export function RereadButton({ jobId }: { jobId: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button variant="secondary" loading={busy} onClick={async () => {
      setBusy(true);
      const r = await retryImport(jobId);
      setBusy(false);
      if (!r.ok) return toast.error(r.error);
      router.refresh();
    }}>{!busy && <RefreshCw />} Volver a leer</Button>
  );
}
