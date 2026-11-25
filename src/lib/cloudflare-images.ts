import "server-only";
import sharp from "sharp";

/**
 * Fotos gratis con Cloudflare Workers AI (FLUX.2 klein 4B): 10.000 "neuronas" gratis por día ≈ 90 fotos de 1024x1024.
 * Variables: CLOUDFLARE_ACCOUNT_ID y CLOUDFLARE_AI_TOKEN (token con permiso "Workers AI").
 * El modelo se puede cambiar con CLOUDFLARE_IMAGE_MODEL.
 */
export const cloudflareReady = () => !!(process.env.CLOUDFLARE_ACCOUNT_ID && process.env.CLOUDFLARE_AI_TOKEN);
const model = () => process.env.CLOUDFLARE_IMAGE_MODEL || "@cf/black-forest-labs/flux-2-klein-4b";

const explain = (status: number, j: { errors?: { message?: string; code?: number }[] } | null) => {
  const m = j?.errors?.[0]?.message ?? `Error ${status}`;
  if (status === 429 || /neuron|limit|quota/i.test(m)) return "Se terminó el cupo gratis de hoy de Cloudflare (se renueva a las 21 hs de Argentina).";
  if (status === 401 || status === 403) return "El token de Cloudflare no es válido o no tiene permiso de Workers AI.";
  if (/nsfw|safety/i.test(m)) return "Cloudflare bloqueó la imagen por sus reglas de contenido. Probá con otra descripción.";
  return m;
};

/** Genera una foto; las fotos de referencia (hasta 4) se achican a 512 px como pide el modelo. Devuelve base64. */
export async function cloudflareImage(prompt: string, images: { mime: string; b64: string }[]) {
  const fd = new FormData();
  const refs = images.length ? `Usá el producto exacto de la imagen de referencia, sin cambiar su forma, colores ni etiquetas. ` : "";
  fd.append("prompt", (refs + prompt).slice(0, 2000));
  fd.append("width", "1024");
  fd.append("height", "1024");
  for (const [i, img] of images.slice(0, 4).entries()) {
    const small = await sharp(Buffer.from(img.b64, "base64")).rotate().resize(511, 511, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    fd.append(`input_image_${i}`, new Blob([new Uint8Array(small)], { type: "image/png" }), `ref-${i}.png`);
  }
  const r = await fetch(`https://api.cloudflare.com/client/v4/accounts/${process.env.CLOUDFLARE_ACCOUNT_ID}/ai/run/${model()}`, {
    method: "POST", cache: "no-store", headers: { authorization: `Bearer ${process.env.CLOUDFLARE_AI_TOKEN}` }, body: fd,
  });
  const type = r.headers.get("content-type") ?? "";
  if (r.ok && type.startsWith("image/")) return [{ mime: type, b64: Buffer.from(await r.arrayBuffer()).toString("base64") }];
  const j = await r.json().catch(() => null);
  if (!r.ok || j?.success === false) throw new Error(explain(r.status, j));
  const b64: string | undefined = j?.result?.image ?? j?.image;
  if (!b64) throw new Error("Cloudflare no devolvió imagen");
  return [{ mime: b64.startsWith("/9j/") ? "image/jpeg" : "image/png", b64 }];
}
