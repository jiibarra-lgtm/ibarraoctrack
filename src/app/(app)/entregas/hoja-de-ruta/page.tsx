import { redirect } from "next/navigation";

/** La "Hoja de ruta" ahora se llama Entregas pendientes. */
export default async function OldBoard({ searchParams }: { searchParams: Promise<{ mes?: string }> }) {
  const { mes } = await searchParams;
  redirect(`/entregas/pendientes${mes ? `?mes=${encodeURIComponent(mes)}` : ""}`);
}
