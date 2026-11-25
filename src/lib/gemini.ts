import "server-only";

/**
 * Google Gemini (Nano Banana para fotos, Veo para videos). La clave va en la variable de entorno GEMINI_API_KEY
 * (se saca en aistudio.google.com › Get API key; las imágenes y videos requieren facturación activada).
 * Los modelos se pueden cambiar sin tocar código con GEMINI_IMAGE_MODEL y GEMINI_VIDEO_MODEL.
 */
const API = "https://generativelanguage.googleapis.com/v1beta";
export const geminiReady = () => !!process.env.GEMINI_API_KEY;
const key = () => {
  const k = process.env.GEMINI_API_KEY;
  if (!k) throw new Error("Falta configurar la clave de Gemini (GEMINI_API_KEY)");
  return k;
};
const imageModel = () => process.env.GEMINI_IMAGE_MODEL || "gemini-2.5-flash-image";
const videoModel = () => process.env.GEMINI_VIDEO_MODEL || "veo-3.0-fast-generate-001";

type Part = { text?: string; inlineData?: { mimeType: string; data: string }; inline_data?: { mime_type: string; data: string } };
const explain = (status: number, j: { error?: { message?: string; status?: string } } | null) => {
  const m = j?.error?.message ?? `Error ${status}`;
  if (status === 429 || /quota|billing/i.test(m)) return "Gemini rechazó el pedido por cuota o facturación: las fotos y videos requieren tener la facturación activada en Google AI Studio.";
  if (status === 400 && /API key/i.test(m)) return "La clave de Gemini no es válida.";
  if (status === 403) return "La clave de Gemini no tiene permiso para este modelo.";
  return m;
};

/** Genera o edita una foto a partir de fotos de referencia + instrucciones. Devuelve las imágenes en base64. */
export async function geminiImage(prompt: string, images: { mime: string; b64: string }[]) {
  const r = await fetch(`${API}/models/${imageModel()}:generateContent`, {
    method: "POST", cache: "no-store",
    headers: { "content-type": "application/json", "x-goog-api-key": key() },
    body: JSON.stringify({
      contents: [{ parts: [...images.map((i) => ({ inline_data: { mime_type: i.mime, data: i.b64 } })), { text: prompt }] }],
      generationConfig: { responseModalities: ["IMAGE", "TEXT"] },
    }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(explain(r.status, j));
  const parts: Part[] = j?.candidates?.[0]?.content?.parts ?? [];
  const out = parts.map((p) => p.inlineData ? { mime: p.inlineData.mimeType, b64: p.inlineData.data } : p.inline_data ? { mime: p.inline_data.mime_type, b64: p.inline_data.data } : null).filter((x): x is { mime: string; b64: string } => !!x);
  const text = parts.map((p) => p.text).filter(Boolean).join(" ");
  if (!out.length) throw new Error(text || j?.promptFeedback?.blockReason ? `Gemini no devolvió imagen${text ? `: ${text}` : ""}` : "Gemini no devolvió imagen");
  return out;
}

/** Empieza un video (tarda 1-3 minutos). Devuelve el nombre de la operación para consultar después. */
export async function geminiVideoStart(prompt: string, image: { mime: string; b64: string } | null, vertical: boolean) {
  const instance: Record<string, unknown> = { prompt };
  if (image) instance.image = { bytesBase64Encoded: image.b64, mimeType: image.mime };
  const r = await fetch(`${API}/models/${videoModel()}:predictLongRunning`, {
    method: "POST", cache: "no-store",
    headers: { "content-type": "application/json", "x-goog-api-key": key() },
    body: JSON.stringify({ instances: [instance], parameters: { aspectRatio: vertical ? "9:16" : "16:9" } }),
  });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(explain(r.status, j));
  return String(j.name);
}

/** Estado del video: listo (con la dirección para bajarlo), en proceso o error. */
export async function geminiVideoStatus(op: string) {
  if (!/^[\w./-]+$/.test(op)) throw new Error("Operación inválida");
  const r = await fetch(`${API}/${op}`, { cache: "no-store", headers: { "x-goog-api-key": key() } });
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(explain(r.status, j));
  if (!j.done) return { done: false as const };
  if (j.error) throw new Error(j.error.message ?? "El video falló");
  const uri: string | undefined = j.response?.generateVideoResponse?.generatedSamples?.[0]?.video?.uri ?? j.response?.generatedVideos?.[0]?.video?.uri;
  if (!uri) throw new Error("Gemini no devolvió el video (puede haberlo bloqueado por política de contenido)");
  return { done: true as const, uri };
}

/** Baja el video generado (la dirección de Google pide la clave). */
export async function geminiDownload(uri: string) {
  const u = new URL(uri);
  if (u.hostname !== "generativelanguage.googleapis.com") throw new Error("Dirección inválida");
  const r = await fetch(uri, { cache: "no-store", headers: { "x-goog-api-key": key() }, redirect: "follow" });
  if (!r.ok) throw new Error(`No se pudo bajar el video (${r.status})`);
  return r;
}
