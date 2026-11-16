"use client";
import * as React from "react";
import { toast } from "sonner";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

/** Botón chico para copiar un texto (por ejemplo, el número de OC). Funciona aunque esté adentro de un link. */
export function CopyButton({ text, label = "Copiar", className }: { text: string; label?: string; className?: string }) {
  const [done, setDone] = React.useState(false);
  const copy = async (e: React.MouseEvent) => {
    e.preventDefault();
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const t = document.createElement("textarea");
      t.value = text; document.body.appendChild(t); t.select();
      try { document.execCommand("copy"); } finally { t.remove(); }
    }
    setDone(true);
    toast.success(`Copiado: ${text}`);
    setTimeout(() => setDone(false), 1500);
  };
  return (
    <button type="button" onClick={copy} title={`Copiar ${text}`} aria-label={`${label} ${text}`}
      className={cn("inline-flex items-center gap-1 rounded-md border border-card-border bg-field px-1.5 py-0.5 text-[11px] font-medium text-fg-muted hover:border-brand hover:text-fg", className)}>
      {done ? <Check className="size-3 text-accent" /> : <Copy className="size-3" />}{done ? "Copiado" : label}
    </button>
  );
}
