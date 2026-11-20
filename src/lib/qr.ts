import QRCode from "qrcode";

/** Lo que puede mostrar un QR al escanearlo. */
export const QR_TARGETS = {
  remito: "El remito",
  oc: "La orden de compra",
  factura: "La factura",
  firmado: "El remito firmado",
  conformidad: "Formulario de conformidad",
  whatsapp: "Chat de WhatsApp",
  url: "Un link que elijas",
} as const;
export type QrTarget = keyof typeof QR_TARGETS;

/** Opciones del menú (cuando el QR muestra varias cosas). */
export const QR_MENU = {
  remito: "Ver el remito",
  oc: "Ver la orden de compra",
  factura: "Descargar la factura",
  firmado: "Ver el remito firmado",
  conformidad: "Confirmar que recibí",
  reclamo: "Hacer un reclamo",
  whatsapp: "Hablar por WhatsApp",
} as const;
export type QrMenuKey = keyof typeof QR_MENU;

export type QrSettings = { color: string; logo: boolean; caption: string; mode: "single" | "menu"; target: QrTarget; menu: QrMenuKey[]; custom_url: string | null; whatsapp: string | null };
export const QR_DEFAULTS: QrSettings = { color: "#0f3d2e", logo: true, caption: "Escaneá para ver este remito", mode: "menu", target: "remito", menu: ["remito", "factura", "conformidad", "reclamo", "whatsapp"], custom_url: null, whatsapp: null };

export const isHex = (c: string) => /^#[0-9a-fA-F]{6}$/.test(c);

/** QR en SVG con el color de la plantilla y, si se pide, el logo de Ibarra en el centro. */
export async function qrSvg(url: string, opts: { color?: string; logo?: boolean; logoHref?: string } = {}) {
  const color = opts.color && isHex(opts.color) ? opts.color : "#111111";
  const svg = await QRCode.toString(url, { type: "svg", margin: 0, errorCorrectionLevel: opts.logo ? "H" : "M", color: { dark: color, light: "#ffffff" } });
  if (!opts.logo) return svg;
  const n = Number(/viewBox="0 0 (\d+) \d+"/.exec(svg)?.[1] ?? 0);
  if (!n) return svg;
  // el logo ocupa ~22% del lado, sobre un recuadro blanco; la corrección de errores alta lo tolera
  const s = Math.round(n * 0.22), p = (n - s) / 2, pad = n * 0.025;
  const mark = `<rect x="${p - pad}" y="${p - pad}" width="${s + pad * 2}" height="${s + pad * 2}" rx="${pad}" fill="#ffffff"/>`
    + `<image href="${opts.logoHref ?? "/brand/qr-mark.png"}" x="${p}" y="${p}" width="${s}" height="${s}" preserveAspectRatio="xMidYMid slice"/>`;
  return svg.replace("</svg>", `${mark}</svg>`);
}

/** Dirección pública del QR (/r/<código>) a partir del host de la app. */
export function qrUrl(origin: string, code: string) {
  return `${origin.replace(/\/$/, "")}/r/${code}`;
}
