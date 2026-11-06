"use client";
import * as React from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Link2, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { syncMlNow } from "./ml-actions";

export function MlSyncButton({ connected }: { connected: boolean }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  if (!connected) return <Button asChild variant="secondary"><Link href="/configuracion#mercadolibre"><Link2 /> Conectar para ver precios</Link></Button>;
  return (
    <Button variant="secondary" loading={busy} onClick={async () => {
      setBusy(true);
      const r = await syncMlNow();
      setBusy(false);
      if (!r.ok) return toast.error(r.error);
      toast.success(r.msg ?? "Sincronizado");
      router.refresh();
    }}>{!busy && <RefreshCw />} Traer precios</Button>
  );
}
