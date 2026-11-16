"use client";
import { toast } from "sonner";

type Res = { ok: true } | { ok: false; error: string };

/**
 * Llama a una acción del servidor sin que un error de red o de versión se pierda en silencio.
 * Si se publicó una versión nueva mientras la página estaba abierta, la acción vieja ya no existe:
 * se avisa que no se guardó y se ofrece recargar.
 */
export async function safeAction<T extends Res>(fn: () => Promise<T>): Promise<T | { ok: false; error: string }> {
  try {
    return await fn();
  } catch (e) {
    const msg = (e as Error)?.message ?? "";
    const stale = /server action|failed to find|unexpected response|fetch/i.test(msg);
    toast.error(stale ? "No se guardó: hay una versión nueva de OC Track. Recargá la página y volvé a cargarlo." : `No se guardó: ${msg || "error de conexión"}`, {
      duration: 15000, action: { label: "Recargar", onClick: () => location.reload() },
    });
    return { ok: false, error: "" };
  }
}
