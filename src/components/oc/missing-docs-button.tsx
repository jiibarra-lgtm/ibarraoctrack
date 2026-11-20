"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { EyeOff } from "lucide-react";
import { dismissMissingOc } from "./missing-docs-actions";

export function DismissMissingOc({ bacNumber }: { bacNumber: string }) {
  const router = useRouter();
  const [busy, setBusy] = React.useState(false);
  return (
    <button type="button" disabled={busy} title="Sacar de la lista (no es mía, se anuló o ya no aplica)"
      className="inline-flex items-center gap-1 rounded-full px-2 py-1 text-xs text-fg-subtle hover:bg-field hover:text-fg disabled:opacity-50"
      onClick={async () => {
        setBusy(true);
        const r = await dismissMissingOc(bacNumber);
        setBusy(false);
        if (!r.ok) return toast.error(r.error ?? "No se pudo");
        toast.success(`OC ${bacNumber} fuera de la lista`, { action: { label: "Deshacer", onClick: async () => { await dismissMissingOc(bacNumber, true); router.refresh(); } } });
        router.refresh();
      }}>
      <EyeOff className="size-3.5" /> Ocultar
    </button>
  );
}
