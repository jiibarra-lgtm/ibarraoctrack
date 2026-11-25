"use client";
import * as React from "react";
import Link from "next/link";
import { toast } from "sonner";
import { Download, ImagePlus, Upload, Video, Wand2, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader, Field, NativeSelect } from "@/components/ui/primitives";
import { mlUploadPicture } from "../pro-actions";
import { studioImage, studioVideoStart, studioVideoStatus } from "./actions";

const PRESETS = [
  { k: "blanco", label: "Fondo blanco (portada ML)", p: "Usá el producto exacto de la foto, sin cambiar su forma, colores, etiquetas ni textos. Ponelo sobre fondo blanco puro (#FFFFFF), centrado, ocupando el 85 % del cuadro, con luz de estudio suave y una sombra leve. Formato cuadrado 1200x1200. Sin textos, logos ni marcas de agua agregadas." },
  { k: "ambiente", label: "En uso / ambiente", p: "Usá el producto exacto de la foto, sin cambiarlo. Mostralo en un ambiente real donde se usa (oficina, depósito, hospital o comercio según el producto), foto profesional, luz natural, fondo desenfocado, cuadrado." },
  { k: "medidas", label: "Infografía con medidas", p: "Usá el producto exacto de la foto sobre fondo blanco y agregá líneas de cota con estas medidas: [ALTO] x [ANCHO] x [PROFUNDIDAD]. Tipografía limpia, gris oscuro, en español. Cuadrado." },
  { k: "pack", label: "Pack / varias unidades", p: "Usá el producto exacto de la foto y mostrá [N] unidades iguales ordenadas prolijamente sobre fondo blanco, foto de estudio, cuadrado." },
  { k: "beneficios", label: "Beneficios destacados", p: "Usá el producto exacto de la foto sobre fondo claro y agregá 3 íconos simples con textos cortos en español: [BENEFICIO 1], [BENEFICIO 2], [BENEFICIO 3]. Diseño limpio y profesional, cuadrado." },
  { k: "libre", label: "Libre", p: "" },
];
const VIDEO = "Video corto de producto, cámara girando lento alrededor del producto exacto de la foto sobre fondo blanco de estudio, luz suave, sin textos ni personas, estilo publicidad de e-commerce.";

/** Achica la foto (máx. 1600 px, JPEG) para mandarla rápido y sin pasar el límite. */
async function shrink(file: Blob, max = 1600): Promise<File> {
  const bmp = await createImageBitmap(file);
  const s = Math.min(1, max / Math.max(bmp.width, bmp.height));
  const c = document.createElement("canvas");
  c.width = Math.round(bmp.width * s); c.height = Math.round(bmp.height * s);
  const ctx = c.getContext("2d")!;
  ctx.fillStyle = "#fff"; ctx.fillRect(0, 0, c.width, c.height);
  ctx.drawImage(bmp, 0, 0, c.width, c.height);
  const b = await new Promise<Blob>((res) => c.toBlob((x) => res(x!), "image/jpeg", 0.9));
  return new File([b], "foto.jpg", { type: "image/jpeg" });
}

export function Studio({ ready, video }: { ready: boolean; video: boolean }) {
  const [refs, setRefs] = React.useState<{ file: File; url: string }[]>([]);
  const [preset, setPreset] = React.useState(PRESETS[0].k);
  const [prompt, setPrompt] = React.useState(PRESETS[0].p);
  const [results, setResults] = React.useState<string[]>([]);
  const [uploaded, setUploaded] = React.useState<Record<string, string>>({});
  const [busy, setBusy] = React.useState<string | null>(null);
  const [vPrompt, setVPrompt] = React.useState(VIDEO);
  const [vertical, setVertical] = React.useState(false);
  const [op, setOp] = React.useState<string | null>(null);
  const [videoReady, setVideoReady] = React.useState(false);
  const input = React.useRef<HTMLInputElement>(null);

  React.useEffect(() => {
    if (!op || videoReady) return;
    const t = setInterval(async () => {
      const r = await studioVideoStatus(op);
      if (!r.ok) { clearInterval(t); setOp(null); toast.error(r.error, { duration: 12000 }); return; }
      if (r.done) { clearInterval(t); setVideoReady(true); toast.success("Video listo"); }
    }, 10000);
    return () => clearInterval(t);
  }, [op, videoReady]);

  const form = (text: string) => { const fd = new FormData(); fd.append("prompt", text); refs.forEach((r) => fd.append("file", r.file)); return fd; };
  const toMl = async (dataUrl: string) => {
    setBusy(dataUrl);
    const f = await shrink(await (await fetch(dataUrl)).blob());
    const fd = new FormData(); fd.append("file", f);
    const r = await mlUploadPicture(fd);
    setBusy(null);
    if (!r.ok) return toast.error(r.error);
    setUploaded((u) => ({ ...u, [dataUrl]: r.id }));
    toast.success("Foto subida a Mercado Libre");
  };
  const ids = Object.values(uploaded);

  if (!ready) return (
    <Card><CardBody className="space-y-2 text-sm">
      <p className="font-medium">Falta conectar la IA de imágenes.</p>
      <p className="text-fg-muted">Es gratis con Cloudflare Workers AI (unas 90 fotos por día): creá un token con permiso “Workers AI” en dash.cloudflare.com y cargá en Vercel <code>CLOUDFLARE_ACCOUNT_ID</code> y <code>CLOUDFLARE_AI_TOKEN</code>. No los pegues en el chat.</p>
    </CardBody></Card>
  );

  return (
    <div className="space-y-5">
      <Card>
        <CardHeader title="1. Fotos del producto" description="Subí 1 a 3 fotos reales (con el celular está bien). Gemini usa el producto tal cual." />
        <CardBody className="flex flex-wrap gap-2">
          {refs.map((r) => (
            <div key={r.url} className="relative"><img src={r.url} alt="" className="size-24 rounded-lg border border-border object-cover" />
              <button type="button" aria-label="Quitar" onClick={() => setRefs(refs.filter((x) => x !== r))} className="absolute -right-1.5 -top-1.5 grid size-6 place-items-center rounded-full bg-danger text-white"><X className="size-3.5" /></button></div>
          ))}
          {refs.length < 3 && <button type="button" onClick={() => input.current?.click()} className="grid size-24 place-items-center rounded-lg border border-dashed border-border text-fg-muted hover:border-brand"><ImagePlus /></button>}
          <input ref={input} type="file" accept="image/*" multiple hidden onChange={async (e) => {
            const fs = [...(e.target.files ?? [])].slice(0, 3 - refs.length); e.target.value = "";
            const out = await Promise.all(fs.map(async (f) => { const s = await shrink(f); return { file: s, url: URL.createObjectURL(s) }; }));
            setRefs((r) => [...r, ...out]);
          }} />
        </CardBody>
      </Card>

      <div className="grid gap-5 lg:grid-cols-2">
        <Card>
          <CardHeader title="2. Foto nueva" />
          <CardBody className="space-y-3">
            <Field label="Tipo" htmlFor="pr">
              <NativeSelect id="pr" value={preset} onChange={(e) => { setPreset(e.target.value); setPrompt(PRESETS.find((p) => p.k === e.target.value)!.p); }}>
                {PRESETS.map((p) => <option key={p.k} value={p.k}>{p.label}</option>)}
              </NativeSelect>
            </Field>
            <textarea value={prompt} onChange={(e) => setPrompt(e.target.value)} rows={5} className="w-full rounded-lg border border-card-border bg-field px-3 py-2 text-sm" placeholder="Describí la foto que querés…" />
            {/\[[A-ZÁÉÍÓÚ0-9 ]+\]/.test(prompt) && <p className="text-xs text-warn">Reemplazá lo que está entre corchetes.</p>}
            <Button loading={busy === "img"} disabled={!refs.length && preset !== "libre"} onClick={async () => {
              setBusy("img"); const r = await studioImage(form(prompt)); setBusy(null);
              if (!r.ok) return toast.error(r.error, { duration: 12000 });
              setResults((x) => [...r.images, ...x]);
            }}><Wand2 /> Generar foto</Button>
            <p className="text-xs text-fg-subtle">ML exige que la foto muestre el producto real: usá esto para mejorar fondo, luz y ambientación, no para inventar el producto.</p>
          </CardBody>
        </Card>

        {video ? (
        <Card>
          <CardHeader title="3. Video corto (clip)" description="Tarda 1 a 3 minutos. Sirve para clips de ML y redes." />
          <CardBody className="space-y-3">
            <textarea value={vPrompt} onChange={(e) => setVPrompt(e.target.value)} rows={4} className="w-full rounded-lg border border-card-border bg-field px-3 py-2 text-sm" />
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={vertical} onChange={(e) => setVertical(e.target.checked)} /> Vertical (9:16, para clips)</label>
            <Button loading={busy === "vid" || (!!op && !videoReady)} onClick={async () => {
              setBusy("vid"); setVideoReady(false);
              const fd = form(vPrompt); if (vertical) fd.append("vertical", "1");
              const r = await studioVideoStart(fd); setBusy(null);
              if (!r.ok) return toast.error(r.error, { duration: 12000 });
              setOp(r.op); toast.message("Generando video… podés seguir usando la app.");
            }}><Video /> {op && !videoReady ? "Generando…" : "Generar video"}</Button>
            {op && videoReady && (
              <div className="space-y-2">
                <video src={`/api/ml/estudio/video?op=${encodeURIComponent(op)}`} controls className="w-full rounded-lg border border-border" />
                <Button asChild size="sm" variant="secondary"><a href={`/api/ml/estudio/video?op=${encodeURIComponent(op)}`} download="video-producto.mp4"><Download /> Descargar</a></Button>
                <p className="text-xs text-fg-subtle">Para subirlo como clip a ML usá la app de Mercado Libre (la API no permite subir clips).</p>
              </div>
            )}
          </CardBody>
        </Card>
        ) : (
          <Card><CardHeader title="3. Video corto (clip)" /><CardBody className="text-sm text-fg-muted">Los videos necesitan una IA paga (Gemini). Las fotos son gratis con Cloudflare.</CardBody></Card>
        )}
      </div>

      {results.length > 0 && (
        <Card>
          <CardHeader title="Resultados" action={ids.length ? <Button asChild size="sm"><Link href={`/mercadolibre/publicar?fotos=${ids.join(",")}`}>Usar {ids.length} en nueva publicación</Link></Button> : null} />
          <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
            {results.map((src) => (
              <div key={src.slice(-40)} className="space-y-1.5">
                <img src={src} alt="Foto generada" className="aspect-square w-full rounded-lg border border-border bg-white object-contain" />
                <div className="flex gap-1">
                  <Button asChild size="sm" variant="ghost"><a href={src} download="foto-producto.png"><Download /></a></Button>
                  {uploaded[src] ? <span className="self-center text-xs text-accent">En ML ✓</span>
                    : <Button size="sm" variant="secondary" loading={busy === src} onClick={() => toMl(src)}><Upload /> Subir a ML</Button>}
                </div>
              </div>
            ))}
          </CardBody>
        </Card>
      )}
    </div>
  );
}
