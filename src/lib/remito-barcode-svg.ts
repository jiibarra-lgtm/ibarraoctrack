import "server-only";
import { toSVG } from "bwip-js/node";

/** SVG del código de barras (negro sobre blanco, con el número abajo). */
export function remitoBarcodeSvg(value: string): string | null {
  try {
    return toSVG({ bcid: "code128", text: value, height: 11, scale: 2, includetext: true, textxalign: "center", textsize: 9, paddingwidth: 6 });
  } catch { return null; }
}
