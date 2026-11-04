import "server-only";
import sharp from "sharp";
import { extractImages, type getDocumentProxy } from "unpdf";

type Pdf = Awaited<ReturnType<typeof getDocumentProxy>>;

/**
 * PDFs sin texto (capturas guardadas con FireShot, "imprimir a PDF" de una imagen, escaneos):
 * se extrae la imagen más grande de cada página y se apilan en una sola imagen vertical,
 * lista para el OCR propio. Devuelve null si el PDF no trae imágenes.
 */
export async function pdfToImage(pdf: Pdf, maxPages = 12): Promise<Buffer | null> {
  const pages: Buffer[] = [];
  for (let n = 1; n <= Math.min(pdf.numPages, maxPages); n++) {
    let imgs: Awaited<ReturnType<typeof extractImages>> = [];
    try {
      imgs = await extractImages(pdf, n);
    } catch {
      continue;
    }
    const big = imgs.filter((i) => i.width >= 200 && i.height >= 100).sort((a, b) => b.width * b.height - a.width * a.height)[0];
    if (!big) continue;
    const channels = big.channels as 1 | 2 | 3 | 4;
    pages.push(await sharp(Buffer.from(big.data), { raw: { width: big.width, height: big.height, channels } }).png().toBuffer());
  }
  if (!pages.length) return null;
  if (pages.length === 1) return pages[0];

  // Ancho común (el mayor) y apilado vertical
  const metas = await Promise.all(pages.map((p) => sharp(p).metadata()));
  const W = Math.max(...metas.map((m) => m.width ?? 0));
  const resized = await Promise.all(pages.map((p, i) => (metas[i].width === W ? p : sharp(p).resize(W, null).png().toBuffer())));
  const heights = await Promise.all(resized.map(async (p) => (await sharp(p).metadata()).height ?? 0));
  const H = heights.reduce((a, b) => a + b, 0);
  let top = 0;
  const composite = resized.map((input, i) => {
    const c = { input, top, left: 0 };
    top += heights[i];
    return c;
  });
  return sharp({ create: { width: W, height: H, channels: 3, background: "#ffffff" } }).composite(composite).png().toBuffer();
}
