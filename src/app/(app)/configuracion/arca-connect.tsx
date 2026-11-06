"use client";
import * as React from "react";
import { useRouter } from "next/navigation";
import { toast } from "sonner";
import { CheckCircle2, Circle, Download, FileKey2, PlugZap, Upload } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Field, Input } from "@/components/ui/primitives";
import { formatDate, formatDateTime } from "@/lib/format";
import { cn } from "@/lib/utils";
import { downloadArcaCsr, generateArcaCsr, saveArcaConfig, testArca, uploadArcaCert } from "./arca-actions";

export type ArcaStatus = { cuit: string | null; point_of_sale: number | null; alias: string; has_csr: boolean; has_cert: boolean; cert_expires_at: string | null; last_check_at: string | null; last_check: string | null; last_error: string | null };

const save = (text: string, name: string) => {
  const a = document.createElement("a");
  a.href = URL.createObjectURL(new Blob([text], { type: "application/pkcs10" }));
  a.download = name; a.click(); URL.revokeObjectURL(a.href);
};

export function ArcaConnect({ status, admin, defaultCuit }: { status: ArcaStatus; admin: boolean; defaultCuit: string }) {
  const router = useRouter();
  const [cuit, setCuit] = React.useState(status.cuit ?? defaultCuit.replace(/\D/g, ""));
  const [pv, setPv] = React.useState(String(status.point_of_sale ?? 4));
  const [busy, setBusy] = React.useState<string | null>(null);
  const file = React.useRef<HTMLInputElement>(null);
  const configured = !!status.cuit && !!status.point_of_sale;
  const ok = status.has_cert && status.last_check_at && !status.last_error;

  const run = async <T,>(k: string, f: () => Promise<T>) => { setBusy(k); try { return await f(); } finally { setBusy(null); } };

  const steps = [
    { done: configured, label: "CUIT y punto de venta" },
    { done: status.has_csr, label: "Pedido de certificado (.csr)" },
    { done: status.has_cert, label: "Certificado de ARCA (.crt)" },
    { done: !!ok, label: "Conexión probada" },
  ];

  return (
    <div className="flex flex-col gap-4 text-sm">
      <ol className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {steps.map((s, i) => (
          <li key={i} className={cn("flex items-center gap-1.5 rounded-xl border px-2.5 py-2 text-xs", s.done ? "border-accent/30 bg-accent-soft text-accent" : "border-card-border text-fg-muted")}>
            {s.done ? <CheckCircle2 className="size-3.5 shrink-0" /> : <Circle className="size-3.5 shrink-0" />}{s.label}
          </li>
        ))}
      </ol>

      {status.last_check && <p className={cn("rounded-xl px-3 py-2 text-xs", status.last_error ? "bg-danger-soft text-danger" : "bg-accent-soft text-accent")}>{status.last_check} <span className="opacity-70">({formatDateTime(status.last_check_at)})</span></p>}
      {status.has_cert && status.cert_expires_at && <p className="text-xs text-fg-subtle">Certificado vigente hasta el {formatDate(status.cert_expires_at)}.</p>}

      {admin && (
        <>
          <div className="grid grid-cols-[minmax(0,1fr)_110px_auto] items-end gap-2">
            <Field label="CUIT que factura" htmlFor="arca-cuit"><Input id="arca-cuit" inputMode="numeric" value={cuit} onChange={(e) => setCuit(e.target.value)} placeholder="20044240522" /></Field>
            <Field label="Punto de venta" htmlFor="arca-pv"><Input id="arca-pv" inputMode="numeric" value={pv} onChange={(e) => setPv(e.target.value)} /></Field>
            <Button variant="secondary" loading={busy === "cfg"} onClick={() => run("cfg", async () => {
              const r = await saveArcaConfig(cuit, pv);
              if (!r.ok) toast.error(r.error); else { toast.success("Guardado"); router.refresh(); }
            })}>Guardar</Button>
          </div>

          <div className="flex flex-wrap gap-2">
            {!status.has_csr ? (
              <Button disabled={!configured} loading={busy === "csr"} onClick={() => run("csr", async () => {
                const r = await generateArcaCsr();
                if (!r.ok) return toast.error(r.error);
                save(r.csr, r.filename); toast.success("Pedido descargado: subilo en ARCA con el alias octrack"); router.refresh();
              })}><FileKey2 /> Generar pedido de certificado</Button>
            ) : (
              <Button variant="secondary" loading={busy === "dl"} onClick={() => run("dl", async () => {
                const r = await downloadArcaCsr();
                if (!r.ok) toast.error(r.error); else save(r.csr, r.filename);
              })}><Download /> Descargar pedido (.csr)</Button>
            )}
            <input ref={file} type="file" hidden accept=".crt,.pem,.cer,text/plain" onChange={async (e) => {
              const f = e.target.files?.[0]; e.target.value = "";
              if (!f) return;
              const text = await f.text();
              await run("crt", async () => {
                const r = await uploadArcaCert(text);
                if (!r.ok) toast.error(r.error); else { toast.success(`Certificado cargado (vence ${formatDate(r.expiresAt)})`); router.refresh(); }
              });
            }} />
            <Button variant={status.has_cert ? "ghost" : "default"} disabled={!status.has_csr} loading={busy === "crt"} onClick={() => file.current?.click()}><Upload /> {status.has_cert ? "Reemplazar certificado" : "Subir certificado (.crt)"}</Button>
            <Button variant="secondary" disabled={!status.has_cert} loading={busy === "test"} onClick={() => run("test", async () => {
              const r = await testArca();
              if (!r.ok) toast.error(r.error); else toast.success(r.message);
              router.refresh();
            })}><PlugZap /> Probar conexión</Button>
          </div>
          {status.has_csr && <p className="text-xs text-fg-subtle">Generar un pedido nuevo invalida el certificado anterior: hacelo sólo si se perdió o venció.</p>}
        </>
      )}
      {!admin && !status.has_cert && <p className="text-xs text-fg-subtle">Lo configura un administrador.</p>}
    </div>
  );
}
