"use client";
import * as React from "react";
import { CheckCircle2 } from "lucide-react";
import { sendClaim } from "./actions";

export function ClaimForm({ code, kind, color }: { code: string; kind: "reclamo" | "conformidad"; color: string }) {
  const [name, setName] = React.useState("");
  const [contact, setContact] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [state, setState] = React.useState<"idle" | "sending" | "done">("idle");
  const [error, setError] = React.useState("");
  if (state === "done") {
    return (
      <p className="flex items-center gap-2 text-black">
        <CheckCircle2 className="size-5 shrink-0" style={{ color }} />
        {kind === "reclamo" ? "Recibimos tu reclamo. Te vamos a contactar a la brevedad." : "¡Gracias! Quedó registrado que recibiste la mercadería."}
      </p>
    );
  }
  const input = "w-full rounded-xl border border-black/10 bg-white px-3 py-2.5 text-[15px] text-black outline-none focus:border-black/30";
  return (
    <form
      className="grid gap-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setState("sending"); setError("");
        const r = await sendClaim({ code, kind, name, contact, message });
        if (!r.ok) { setError(r.error); setState("idle"); } else setState("done");
      }}
    >
      <label className="grid gap-1 text-xs font-medium text-black/60">Nombre y apellido
        <input className={input} value={name} onChange={(e) => setName(e.target.value)} required minLength={2} maxLength={120} autoComplete="name" />
      </label>
      <label className="grid gap-1 text-xs font-medium text-black/60">Teléfono o mail (opcional)
        <input className={input} value={contact} onChange={(e) => setContact(e.target.value)} maxLength={120} />
      </label>
      <label className="grid gap-1 text-xs font-medium text-black/60">{kind === "reclamo" ? "¿Qué pasó?" : "Comentario (opcional)"}
        <textarea className={input} rows={kind === "reclamo" ? 4 : 2} value={message} onChange={(e) => setMessage(e.target.value)} maxLength={2000}
          placeholder={kind === "reclamo" ? "Faltó un renglón, llegó roto, cantidad distinta…" : "Recibido conforme"} />
      </label>
      {error && <p className="text-sm text-red-600">{error}</p>}
      <button type="submit" disabled={state === "sending"} className="rounded-xl px-4 py-3 text-[15px] font-semibold text-white disabled:opacity-60" style={{ background: color }}>
        {state === "sending" ? "Enviando…" : kind === "reclamo" ? "Enviar reclamo" : "Confirmar recepción"}
      </button>
    </form>
  );
}
