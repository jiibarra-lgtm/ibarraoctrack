import "server-only";

/**
 * Fotos con OpenAI (gpt-image). Usa la clave OPENAI_API_KEY; con ChatGPT Pro los créditos mensuales de API cubren estas imágenes.
 * El modelo se puede cambiar con OPENAI_IMAGE_MODEL sin tocar código.
 */
const API = "https://api.openai.com/v1";
export const openaiReady = () => !!process.env.OPENAI_API_KEY;
const key = () => {
  const k = process.env.OPENAI_API_KEY;
  if (!k) throw new Error("Falta configurar la clave de OpenAI (OPENAI_API_KEY)");
  return k;
};
const model = () => process.env.OPENAI_IMAGE_MODEL || "gpt-image-1";

const explain = (status: number, j: { error?: { message?: string; code?: string } } | null) => {
  const m = j?.error?.message ?? `Error ${status}`;
  if (j?.error?.code === "credit_balance_exhausted" || /quota|billing|credit/i.test(m)) return "OpenAI rechazó el pedido: no quedan créditos de API (reclamá los créditos de tu ChatGPT Pro en Configuración › Facturación).";
  if (status === 401) return "La clave de OpenAI no es válida.";
  if (/verif/i.test(m)) return "OpenAI pide verificar la organización para usar este modelo de imágenes (platform.openai.com › Settings › Organization › Verify).";
  if (/safety|moderation/i.test(m)) return "OpenAI bloqueó la imagen por sus reglas de contenido. Probá con otra descripción.";
  return m;
};

/** Genera una foto; si hay fotos de referencia, edita a partir de ellas (mantiene el producto). Devuelve base64. */
export async function openaiImage(prompt: string, images: { mime: string; b64: string }[]) {
  let r: Response;
  if (images.length) {
    const fd = new FormData();
    fd.append("model", model());
    fd.append("prompt", prompt);
    fd.append("size", "1024x1024");
    fd.append("quality", "high");
    images.forEach((img, i) => fd.append("image[]", new Blob([Buffer.from(img.b64, "base64")], { type: img.mime }), `ref-${i}.${img.mime.split("/")[1] ?? "jpg"}`));
    r = await fetch(`${API}/images/edits`, { method: "POST", cache: "no-store", headers: { authorization: `Bearer ${key()}` }, body: fd });
  } else {
    r = await fetch(`${API}/images/generations`, {
      method: "POST", cache: "no-store",
      headers: { authorization: `Bearer ${key()}`, "content-type": "application/json" },
      body: JSON.stringify({ model: model(), prompt, size: "1024x1024", quality: "high" }),
    });
  }
  const j = await r.json().catch(() => null);
  if (!r.ok) throw new Error(explain(r.status, j));
  const out = ((j?.data ?? []) as { b64_json?: string }[]).filter((d) => d.b64_json).map((d) => ({ mime: "image/png", b64: d.b64_json! }));
  if (!out.length) throw new Error("OpenAI no devolvió imagen");
  return out;
}
