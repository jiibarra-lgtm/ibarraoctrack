"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setPurchasePaid } from "@/app/(app)/facturacion/actions";

export function PaidToggle({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button size="sm" variant="secondary" loading={busy} onClick={async () => {
      setBusy(true);
      const r = await setPurchasePaid(id, true);
      setBusy(false);
      if (!r.ok) return toast.error(r.error);
      toast.success("Marcada como pagada");
      router.refresh();
    }}><Check /> Pagada</Button>
  );
}
