"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { ArrowDownLeft, ArrowUpRight } from "lucide-react";
import { Button } from "@/components/ui/button";
import { setDirection } from "./actions";

/** Botones Entró / Salió para transferencias que el saldo no alcanzó a resolver. */
export function DirectionButtons({ id }: { id: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  const go = async (d: "in" | "out") => {
    setBusy(true);
    const r = await setDirection(id, d);
    setBusy(false);
    if (!r.ok) toast.error(r.error);
    else { toast.success(r.n > 1 ? `Listo, se resolvieron ${r.n} movimientos` : "Listo, la próxima vez se reconoce solo"); router.refresh(); }
  };
  return (
    <div className="flex gap-1">
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => go("in")}><ArrowDownLeft className="size-3.5" />Entró</Button>
      <Button size="sm" variant="secondary" disabled={busy} onClick={() => go("out")}><ArrowUpRight className="size-3.5" />Salió</Button>
    </div>
  );
}
