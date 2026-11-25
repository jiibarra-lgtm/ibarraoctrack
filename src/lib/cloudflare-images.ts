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
  if (/nsfw|safety|flagged/i.test(m)) return "El filtro de seguridad de la IA bloqueó esta foto aunque se probó 3 veces. A veces es un falso positivo: probá con otra foto del producto (más de cerca, fondo liso, sin personas) o con el tipo “Libre” y una descripción corta.";
  if (status === 401 || status === 403) return "El token de Cloudflare no es válido o no tiene permiso de Workers AI.";
  return m;
};

/** Genera una foto; las fotos de referencia (hasta 4) se achican a 512 px como pide el modelo. Devuelve base64. */
export async function cloudflareImage(prompt: string, images: { mime: string; b64: string }[]) {
  const refs: Blob[] = [];
  for (const img of images.slice(0, 4)) {
    const small = await sharp(Buffer.from(img.b64, "base64")).rotate().resize(511, 511, { fit: "inside", withoutEnlargement: true }).png().toBuffer();
    refs.push(new Blob([new Uint8Array(small)], { type: "image/png" }));
  }
  const text = `${refs.length ? "Commercial e-commerce product photography. Keep the exact product from the reference image (same shape, colors, label and text). " : "Commercial e-commerce product photography. "}${prompt}`.slice(0, 2000);
  // el filtro de seguridad a veces bloquea por error: se reintenta con otra variación (semilla) antes de avisar
  let last: Error | null = null;
  for (let attempt = 0; attempt < 3; attempt++) {
    try { return await runOnce(text, refs); } catch (e) {
      last = e as Error;
      if (!/flagged|nsfw|safety|filtro de seguridad/i.test(last.message)) throw last;
    }
  }
  throw last!;
}

async function runOnce(prompt: string, refs: Blob[]) {
  const fd = new FormData();
  fd.append("prompt", prompt);
  fd.append("width", "1024");
  fd.append("height", "1024");
  fd.append("seed", String(Math.floor(Math.random() * 2_000_000_000)));
  refs.forEach((b, i) => fd.append(`input_image_${i}`, b, `ref-${i}.png`));
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
