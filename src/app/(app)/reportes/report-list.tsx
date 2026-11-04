"use client";
import * as React from "react";
import { Download, FileSpreadsheet } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, Field, Input } from "@/components/ui/primitives";

export function ReportList({ reports }: { reports: { key: string; label: string; description: string }[] }) {
  const [from, setFrom] = React.useState("");
  const [to, setTo] = React.useState("");
  const qs = new URLSearchParams({ ...(from ? { desde: from } : {}), ...(to ? { hasta: to } : {}) }).toString();
  return (
    <div className="flex flex-col gap-4">
      <Card>
        <CardBody className="flex flex-wrap items-end gap-3">
          <Field label="Desde" htmlFor="r-from"><Input id="r-from" type="date" value={from} onChange={(e) => setFrom(e.target.value)} /></Field>
          <Field label="Hasta" htmlFor="r-to"><Input id="r-to" type="date" value={to} onChange={(e) => setTo(e.target.value)} /></Field>
          {(from || to) && <Button variant="ghost" onClick={() => { setFrom(""); setTo(""); }}>Todo el período</Button>}
          <p className="pb-2 text-xs text-fg-subtle">{from || to ? "Se filtra por la fecha principal de cada reporte." : "Sin filtro: se descarga todo."}</p>
        </CardBody>
      </Card>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {reports.map((r) => (
          <div key={r.key} className="glass flex flex-col rounded-2xl p-4">
            <span className="grid size-9 place-items-center rounded-full border border-card-border bg-field text-accent"><FileSpreadsheet className="size-4" /></span>
            <p className="mt-3 text-sm font-semibold">{r.label}</p>
            <p className="mt-0.5 flex-1 text-xs text-fg-subtle">{r.description}</p>
            <Button asChild size="sm" className="mt-3 self-start">
              <a href={`/api/reportes/${r.key}${qs ? `?${qs}` : ""}`} download><Download /> Descargar</a>
            </Button>
          </div>
        ))}
      </div>
    </div>
  );
}
