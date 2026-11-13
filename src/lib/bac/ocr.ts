import "server-only";
import path from "node:path";
import sharp from "sharp";
import { createWorker } from "tesseract.js";

/**
 * OCR propio (Tesseract, sin servicios externos) para capturas de "Ver documento contractual".
 * Preprocesado probado sobre capturas de BAC: escala 2,5×, escala de grises y umbral, que rescata
 * los textos grises chicos (fechas, importes). La captura larga se procesa por tramos con solape
 * y se eliminan las líneas repetidas del solape.
 */
const SCALE = 2.5;
const THRESHOLD = 185;
const TILE = 2200;
const OVERLAP = 150;

function langPath() {
  return path.join(process.cwd(), "node_modules", "@tesseract.js-data", "spa", "4.0.0_best_int");
}

/** Une textos de tramos consecutivos quitando las líneas duplicadas por el solape. */
export function joinTiles(parts: string[]): string {
  const norm = (l: string) => l.replace(/\s+/g, " ").trim().toLowerCase();
  const out: string[] = [];
  for (const part of parts) {
    const lines = part.split("\n");
    const tail = new Set(out.slice(-25).map(norm).filter((l) => l.length > 8));
    let start = 0;
    // Saltear el bloque inicial que ya apareció al final del tramo anterior
    for (let i = 0; i < Math.min(lines.length, 25); i++) {
      const n = norm(lines[i]);
      if (!n) continue;
      if (tail.has(n)) start = i + 1;
    }
    out.push(...lines.slice(start));
  }
  return out.join("\n");
}

export async function ocrImage(buffer: Buffer): Promise<{ text: string; confidence: number }> {
  return ocrImages([buffer]);
}

/** Varias imágenes (p. ej. una por página) con un solo motor de OCR; los textos se unen en orden. */
export async function ocrImages(buffers: Buffer[]): Promise<{ text: string; confidence: number }> {
  const worker = await createWorker("spa", 1, { langPath: langPath(), gzip: true, cachePath: "/tmp/tesseract" });
  try {
    await worker.setParameters({ preserve_interword_spaces: "1", tessedit_pageseg_mode: "4" as never });
    const texts: string[] = [], confs: number[] = [];
    for (const b of buffers) {
      const r = await ocrWith(worker, b);
      texts.push(r.text); confs.push(r.confidence);
    }
    return { text: texts.join("\n"), confidence: confs.reduce((a, c) => a + c, 0) / Math.max(1, confs.length) };
  } finally {
    await worker.terminate();
  }
}

async function ocrWith(worker: Awaited<ReturnType<typeof createWorker>>, buffer: Buffer): Promise<{ text: string; confidence: number }> {
  const meta = await sharp(buffer, { failOn: "none" }).rotate().metadata();
  if (!meta.width || !meta.height) throw new Error("No se pudo leer la imagen");
  // Capturas angostas se agrandan más; muy anchas, menos (límite de memoria)
  const scale = Math.min(SCALE, 4000 / meta.width);
  const W = Math.round(meta.width * scale);
  const base = await sharp(buffer, { failOn: "none" })
    .rotate()
    .resize(W, null, { kernel: "lanczos3" })
    .grayscale()
    .threshold(THRESHOLD)
    .png()
    .toBuffer();
  const H = (await sharp(base).metadata()).height ?? 0;

  {
    const parts: string[] = [];
    const confs: number[] = [];
    for (let top = 0; top < H; top += TILE - OVERLAP) {
      const h = Math.min(TILE, H - top);
      const tile = await sharp(base).extract({ left: 0, top, width: W, height: h }).png().toBuffer();
      const { data } = await worker.recognize(tile);
      parts.push(data.text);
      confs.push(data.confidence);
      if (top + h >= H || parts.length >= 15) break;
    }
    return { text: joinTiles(parts), confidence: confs.reduce((a, b) => a + b, 0) / Math.max(1, confs.length) };
  }
}
