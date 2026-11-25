"use server";
import { requireOrg, canWrite } from "@/lib/session";
import { geminiImage, geminiReady, geminiVideoStart, geminiVideoStatus } from "@/lib/gemini";
import { openaiImage, openaiReady } from "@/lib/openai-images";

type R<T = object> = ({ ok: true } & T) | { ok: false; error: string };
const fail = (e: unknown) => ({ ok: false as const, error: (e as Error).message || "Error" });

async function files(form: FormData) {
  const out: { mime: string; b64: string }[] = [];
  for (const f of form.getAll("file")) {
    if (!(f instanceof File) || !f.size) continue;
    if (!/^image\/(jpeg|png|webp)$/.test(f.type)) throw new Error("Solo fotos JPG, PNG o WEBP");
    out.push({ mime: f.type, b64: Buffer.from(await f.arrayBuffer()).toString("base64") });
  }
  return out.slice(0, 3);
}
async function guard() {
  const s = await requireOrg();
  if (!canWrite(s.org.role)) throw new Error("No tenés permiso");
}

export async function studioImage(form: FormData): Promise<R<{ images: string[] }>> {
  try {
    await guard();
    const prompt = String(form.get("prompt") ?? "").trim().slice(0, 2000);
    if (prompt.length < 5) return { ok: false, error: "Escribí qué querés" };
    const imgs = await files(form);
    // OpenAI primero (créditos de ChatGPT Pro); Gemini si es la única clave cargada
    const out = openaiReady() || !geminiReady() ? await openaiImage(prompt, imgs) : await geminiImage(prompt, imgs);
    return { ok: true, images: out.map((x) => `data:${x.mime};base64,${x.b64}`) };
  } catch (e) { return fail(e); }
}

export async function studioVideoStart(form: FormData): Promise<R<{ op: string }>> {
  try {
    await guard();
    const prompt = String(form.get("prompt") ?? "").trim().slice(0, 2000);
    if (prompt.length < 5) return { ok: false, error: "Escribí cómo querés el video" };
    const [img] = await files(form);
    const op = await geminiVideoStart(prompt, img ?? null, form.get("vertical") === "1");
    return { ok: true, op };
  } catch (e) { return fail(e); }
}

export async function studioVideoStatus(op: string): Promise<R<{ done: boolean }>> {
  try {
    await guard();
    const r = await geminiVideoStatus(op);
    return { ok: true, done: r.done };
  } catch (e) { return fail(e); }
}
