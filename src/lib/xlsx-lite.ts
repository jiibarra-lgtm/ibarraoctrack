import { unzipSync, strFromU8 } from "fflate";

/** Lee la primera hoja de un .xlsx como matriz de valores (texto o número). Sin dependencias: zip + XML. */
export function readXlsx(bytes: Uint8Array): (string | number | null)[][] {
  const files = unzipSync(bytes, { filter: (f) => f.name === "xl/sharedStrings.xml" || f.name === "xl/workbook.xml" || /^xl\/worksheets\/sheet[^/]*\.xml$/.test(f.name) || f.name === "xl/_rels/workbook.xml.rels" });
  const dec = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&#(\d+);/g, (_, n) => String.fromCodePoint(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCodePoint(parseInt(n, 16))).replace(/&amp;/g, "&");
  const shared: string[] = [];
  // algunos sistemas (como el BAC) escriben las etiquetas con prefijo de espacio de nombres: <x:row>
  const noNs = (x: string) => x.replace(/<(\/?)[A-Za-z]+:/g, "<$1");
  const ss = files["xl/sharedStrings.xml"] ? noNs(strFromU8(files["xl/sharedStrings.xml"])) : "";
  for (const si of ss.match(/<si>[\s\S]*?<\/si>/g) ?? []) shared.push(dec((si.match(/<t[^>]*>([\s\S]*?)<\/t>/g) ?? []).map((t) => t.replace(/<t[^>]*>|<\/t>/g, "")).join("")));
  const sheetName = Object.keys(files).filter((n) => /^xl\/worksheets\/sheet[^/]*\.xml$/.test(n)).sort()[0];
  if (!sheetName) throw new Error("El archivo no tiene hojas");
  const xml = noNs(strFromU8(files[sheetName]));
  const rows: (string | number | null)[][] = [];
  const col = (ref: string) => { let n = 0; for (const ch of ref.replace(/\d+/g, "")) n = n * 26 + ch.charCodeAt(0) - 64; return n - 1; };
  for (const r of xml.match(/<row[^>]*>[\s\S]*?<\/row>|<row[^>]*\/>/g) ?? []) {
    const row: (string | number | null)[] = [];
    for (const c of r.match(/<c [^>]*?(?:\/>|>[\s\S]*?<\/c>)/g) ?? []) {
      const ref = /r="([A-Z]+)\d+"/.exec(c)?.[1];
      const t = /t="([^"]+)"/.exec(c)?.[1];
      const v = /<v>([\s\S]*?)<\/v>/.exec(c)?.[1];
      const inline = /<is>[\s\S]*?<t[^>]*>([\s\S]*?)<\/t>/.exec(c)?.[1];
      let val: string | number | null = null;
      if (t === "s" && v !== undefined) val = shared[Number(v)] ?? null;
      else if (t === "inlineStr" && inline !== undefined) val = dec(inline);
      else if (t === "str" && v !== undefined) val = dec(v);
      else if (v !== undefined) val = Number.isFinite(Number(v)) ? Number(v) : dec(v);
      row[ref ? col(ref) : row.length] = val;
    }
    rows.push(Array.from(row, (x) => x ?? null));
  }
  return rows;
}
