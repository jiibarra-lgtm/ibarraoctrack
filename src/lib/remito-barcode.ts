/**
 * Código de barras del remito (Code 128, sólo números): 9 + provisorio(1/0) + punto de venta (4) + número (8) = 14 dígitos.
 * Lo lee cualquier lector y la cámara de la app (Remitos → Escanear) para confirmar la entrega.
 */
export const remitoBarcodeValue = (provisional: boolean, pos: number, number: number) =>
  `9${provisional ? 1 : 0}${String(pos).padStart(4, "0").slice(-4)}${String(number).padStart(8, "0").slice(-8)}`;

export function parseRemitoBarcode(text: string): { provisional: boolean; pos: number; number: number } | null {
  const t = text.replace(/\D/g, "");
  const m = /^9([01])(\d{4})(\d{8})$/.exec(t);
  if (!m) return null;
  return { provisional: m[1] === "1", pos: Number(m[2]), number: Number(m[3]) };
}

export type ScanSettings = { barcode_provisional: boolean; barcode_official: boolean; scan_action: "entregado" | "firmado"; scan_confirm: boolean };
export const SCAN_DEFAULTS: ScanSettings = { barcode_provisional: true, barcode_official: false, scan_action: "entregado", scan_confirm: false };
