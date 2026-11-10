import { NextResponse } from "next/server";

/**
 * Notificaciones de Mercado Libre (tópicos de la aplicación). ML exige responder 200 enseguida;
 * los datos se traen con la sincronización (mails nuevos o "Traer precios"), así que acá sólo se confirma la recepción.
 */
export async function POST() {
  return NextResponse.json({ ok: true });
}
export async function GET() {
  return NextResponse.json({ ok: true });
}
