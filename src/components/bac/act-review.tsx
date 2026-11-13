"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { reviewAct } from "@/app/(app)/bac/act-actions";

export function ActReview({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <Button size="sm" variant="secondary" loading={busy} onClick={async () => {
      setBusy(true); const r = await reviewAct(id); setBusy(false);
      if (!r.ok) toast.error(r.error); else router.refresh();
    }}>{!busy && <Check className="size-3.5" />}Listo</Button>
  );
}
