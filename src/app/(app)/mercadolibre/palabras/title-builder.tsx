"use client";
import * as React from "react";
import Link from "next/link";
import { Input } from "@/components/ui/primitives";
import { Button } from "@/components/ui/button";
import { CopyButton } from "../pro-ui";

export function TitleBuilder({ suggestions }: { suggestions: string[] }) {
  const [t, setT] = React.useState("");
  const add = (w: string) => { const n = `${t.trim()} ${w.charAt(0).toUpperCase()}${w.slice(1)}`.trim(); if (n.length <= 60) setT(n); };
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Input value={t} onChange={(e) => setT(e.target.value.slice(0, 60))} placeholder="Ej. Resma A4 75 g Autor" />
        <span className={`self-center text-xs tabular ${t.length > 55 ? "text-warn" : "text-fg-subtle"}`}>{t.length}/60</span>
      </div>
      <div className="flex flex-wrap gap-1.5">
        {suggestions.map((w) => <button key={w} type="button" disabled={t.toLowerCase().includes(w)} onClick={() => add(w)} className="rounded-full border border-border bg-field px-2.5 py-1 text-xs hover:border-brand disabled:opacity-40">+ {w}</button>)}
      </div>
      {t && <div className="flex gap-2"><CopyButton text={t} /><Button asChild size="sm" variant="secondary"><Link href="/mercadolibre/publicar">Ir a publicar</Link></Button></div>}
    </div>
  );
}
