"use server";
import { z } from "zod";
import { anonDb } from "@/lib/qr-public";

const Claim = z.object({
  code: z.string().regex(/^[A-Za-z0-9]{6,12}$/),
  kind: z.enum(["reclamo", "conformidad"]),
  name: z.string().trim().min(2, "Poné tu nombre").max(120),
  contact: z.string().trim().max(120).optional().default(""),
  message: z.string().trim().max(2000).optional().default(""),
});

/** Reclamo o conformidad que deja quien escanea el QR (sin usuario). */
export async function sendClaim(input: z.input<typeof Claim>): Promise<{ ok: true } | { ok: false; error: string }> {
  const p = Claim.safeParse(input);
  if (!p.success) return { ok: false, error: p.error.issues[0]?.message ?? "Datos inválidos" };
  if (p.data.kind === "reclamo" && p.data.message.length < 5) return { ok: false, error: "Contanos qué pasó" };
  const { data, error } = await anonDb().rpc("qr_claim", { p_code: p.data.code, p_kind: p.data.kind, p_name: p.data.name, p_contact: p.data.contact, p_message: p.data.message });
  if (error || data !== true) return { ok: false, error: "No se pudo enviar. Probá de nuevo en un rato." };
  return { ok: true };
}
