"use client";
import * as React from "react";
import { Check, Copy } from "lucide-react";
import { cn } from "@/lib/utils";

export function CopyButton({ value, className }: { value: string; className?: string }) {
  const [ok, setOk] = React.useState(false);
  return (
    <button type="button" aria-label="Copiar" title="Copiar número"
      onClick={(e) => { e.preventDefault(); e.stopPropagation(); navigator.clipboard?.writeText(value).then(() => { setOk(true); setTimeout(() => setOk(false), 1200); }); }}
      className={cn("inline-grid size-6 place-items-center rounded-md text-fg-subtle hover:bg-surface-2 hover:text-fg", className)}>
      {ok ? <Check className="size-3.5 text-accent" /> : <Copy className="size-3.5" />}
    </button>
  );
}
