import { strToU8, zipSync } from "fflate";

/**
 * Excel con formato (sin dependencias además de fflate): cuadros con encabezado de color, bordes,
 * pesos y porcentajes con formato, anchos de columna, filtros y fila de encabezado fija.
 */
export type Style =
  | "text" | "wrap" | "money" | "moneyBold" | "moneyRed" | "moneyGreen" | "pct" | "pctRed" | "pctGreen" | "int" | "intBold"
  | "title" | "subtitle" | "label" | "headDark" | "headRed" | "headGreen" | "headAmber" | "headGrey" | "headBlue" | "totalLabel" | "missing" | "plain";
export type Cell = string | number | null | undefined | { v: string | number | null | undefined; s: Style };
export type StyledSheet = {
  name: string;
  rows: Cell[][];
  widths?: number[];
  /** fila (0-based) del encabezado de la tabla: se fija y lleva filtro */
  headerRow?: number;
  merges?: string[];
};

const STYLES: Style[] = ["plain", "text", "wrap", "money", "moneyBold", "moneyRed", "moneyGreen", "pct", "pctRed", "pctGreen", "int", "intBold",
  "title", "subtitle", "label", "headDark", "headRed", "headGreen", "headAmber", "headGrey", "headBlue", "totalLabel", "missing"];
const idx = (s: Style) => STYLES.indexOf(s);

// fonts: 0 normal, 1 bold, 2 bold white, 3 title, 4 italic grey, 5 red, 6 green, 7 bold red? (unused)
const FONTS = [
  `<font><sz val="11"/><name val="Calibri"/></font>`,
  `<font><b/><sz val="11"/><name val="Calibri"/></font>`,
  `<font><b/><sz val="11"/><color rgb="FFFFFFFF"/><name val="Calibri"/></font>`,
  `<font><b/><sz val="16"/><color rgb="FF1F2937"/><name val="Calibri"/></font>`,
  `<font><i/><sz val="10"/><color rgb="FF6B7280"/><name val="Calibri"/></font>`,
  `<font><b/><sz val="11"/><color rgb="FFB42318"/><name val="Calibri"/></font>`,
  `<font><b/><sz val="11"/><color rgb="FF1E7A46"/><name val="Calibri"/></font>`,
  `<font><i/><sz val="10"/><color rgb="FFB45309"/><name val="Calibri"/></font>`,
];
const fill = (rgb: string) => `<fill><patternFill patternType="solid"><fgColor rgb="FF${rgb}"/><bgColor indexed="64"/></patternFill></fill>`;
// fills: 0 none, 1 gray125 (obligatorios), 2 dark, 3 red, 4 green, 5 amber, 6 grey, 7 blue, 8 light total
const FILLS = [`<fill><patternFill patternType="none"/></fill>`, `<fill><patternFill patternType="gray125"/></fill>`,
  fill("1F2937"), fill("B42318"), fill("1E7A46"), fill("B45309"), fill("6B7280"), fill("1D4ED8"), fill("F3F4F6"), fill("FEF3C7")];
const BORDERS = [`<border/>`, `<border><left style="thin"><color rgb="FFD1D5DB"/></left><right style="thin"><color rgb="FFD1D5DB"/></right><top style="thin"><color rgb="FFD1D5DB"/></top><bottom style="thin"><color rgb="FFD1D5DB"/></bottom></border>`];
// numFmts: 164 money, 165 pct, 166 int
const NUMFMTS = `<numFmts count="3"><numFmt numFmtId="164" formatCode="&quot;$&quot; #,##0.00;[Red]-&quot;$&quot; #,##0.00"/><numFmt numFmtId="165" formatCode="0.0%"/><numFmt numFmtId="166" formatCode="#,##0"/></numFmts>`;

function xf(s: Style) {
  const b = 1;
  const x = (font: number, fillId: number, border: number, fmt = 0, wrap = false, center = false) =>
    `<xf numFmtId="${fmt}" fontId="${font}" fillId="${fillId}" borderId="${border}"${fmt ? ' applyNumberFormat="1"' : ""} applyFont="1" applyFill="1" applyBorder="1"${wrap || center ? ` applyAlignment="1"><alignment vertical="center"${wrap ? ' wrapText="1"' : ""}${center ? ' horizontal="center"' : ""}/></xf>` : "/>"}`;
  switch (s) {
    case "plain": return x(0, 0, 0);
    case "text": return x(0, 0, b);
    case "wrap": return x(0, 0, b, 0, true);
    case "money": return x(0, 0, b, 164);
    case "moneyBold": return x(1, 8, b, 164);
    case "moneyRed": return x(5, 0, b, 164);
    case "moneyGreen": return x(6, 0, b, 164);
    case "pct": return x(0, 0, b, 165);
    case "pctRed": return x(5, 0, b, 165);
    case "pctGreen": return x(6, 0, b, 165);
    case "int": return x(0, 0, b, 166);
    case "intBold": return x(1, 8, b, 166);
    case "title": return x(3, 0, 0);
    case "subtitle": return x(4, 0, 0, 0, true);
    case "label": return x(1, 0, b);
    case "headDark": return x(2, 2, b, 0, true, true);
    case "headRed": return x(2, 3, b, 0, true, true);
    case "headGreen": return x(2, 4, b, 0, true, true);
    case "headAmber": return x(2, 5, b, 0, true, true);
    case "headGrey": return x(2, 6, b, 0, true, true);
    case "headBlue": return x(2, 7, b, 0, true, true);
    case "totalLabel": return x(1, 8, b);
    case "missing": return x(7, 9, b, 0, false, true);
  }
}

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;")
  .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, "");
export function col(i: number) {
  let s = "";
  for (let n = i + 1; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s;
  return s;
}

function sheetXml(sh: StyledSheet) {
  const width = Math.max(1, ...sh.rows.map((r) => r.length));
  const cols = sh.widths?.length ? `<cols>${sh.widths.map((w, i) => `<col min="${i + 1}" max="${i + 1}" width="${w}" customWidth="1"/>`).join("")}</cols>` : "";
  const body = sh.rows.map((r, ri) => `<row r="${ri + 1}">${r.map((c, ci) => {
    const { v, s } = c !== null && typeof c === "object" ? c : { v: c, s: "plain" as Style };
    const ref = `${col(ci)}${ri + 1}`;
    const st = idx(s) > 0 ? ` s="${idx(s)}"` : "";
    if (v === null || v === undefined || v === "") return st ? `<c r="${ref}"${st}/>` : "";
    if (typeof v === "number" && Number.isFinite(v)) return `<c r="${ref}"${st}><v>${v}</v></c>`;
    return `<c r="${ref}" t="inlineStr"${st}><is><t xml:space="preserve">${esc(String(v).slice(0, 32000))}</t></is></c>`;
  }).join("")}</row>`).join("");
  const h = sh.headerRow;
  const pane = h !== undefined ? `<sheetViews><sheetView workbookViewId="0"><pane ySplit="${h + 1}" topLeftCell="A${h + 2}" activePane="bottomLeft" state="frozen"/></sheetView></sheetViews>` : `<sheetViews><sheetView workbookViewId="0"/></sheetViews>`;
  const last = sh.rows.length;
  const filter = h !== undefined && last > h + 1 ? `<autoFilter ref="A${h + 1}:${col(width - 1)}${last}"/>` : "";
  const merges = sh.merges?.length ? `<mergeCells count="${sh.merges.length}">${sh.merges.map((m) => `<mergeCell ref="${m}"/>`).join("")}</mergeCells>` : "";
  // Al imprimir o pasar a PDF: horizontal y todo el ancho en una hoja
  return `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetPr><pageSetUpPr fitToPage="1"/></sheetPr>${pane}<sheetFormatPr defaultRowHeight="18"/>${cols}<sheetData>${body}</sheetData>${filter}${merges}<pageMargins left="0.4" right="0.4" top="0.5" bottom="0.5" header="0.3" footer="0.3"/><pageSetup orientation="landscape" paperSize="9" fitToWidth="1" fitToHeight="0"/></worksheet>`;
}

export function writeStyledXlsx(sheets: StyledSheet[]): Uint8Array {
  const used = new Set<string>();
  const names = sheets.map((s) => {
    let n = s.name.replace(/[\\/?*[\]:]/g, " ").slice(0, 31) || "Hoja";
    for (let i = 2; used.has(n.toLowerCase()); i++) n = `${n.slice(0, 28)} ${i}`;
    used.add(n.toLowerCase());
    return n;
  });
  const styles = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?><styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">${NUMFMTS}<fonts count="${FONTS.length}">${FONTS.join("")}</fonts><fills count="${FILLS.length}">${FILLS.join("")}</fills><borders count="${BORDERS.length}">${BORDERS.join("")}</borders><cellStyleXfs count="1"><xf/></cellStyleXfs><cellXfs count="${STYLES.length}">${STYLES.map(xf).join("")}</cellXfs></styleSheet>`;
  // Los filtros necesitan un nombre definido por hoja
  const defined = sheets.map((s, i) => {
    const w = Math.max(1, ...s.rows.map((r) => r.length));
    return s.headerRow !== undefined && s.rows.length > s.headerRow + 1
      ? `<definedName name="_xlnm._FilterDatabase" localSheetId="${i}" hidden="1">'${esc(names[i]).replace(/'/g, "''")}'!$A$${s.headerRow + 1}:$${col(w - 1)}$${s.rows.length}</definedName>` : "";
  }).join("");
  const files: Record<string, Uint8Array> = {
    "[Content_Types].xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/><Override PartName="/xl/styles.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.styles+xml"/>${sheets.map((_, i) => `<Override PartName="/xl/worksheets/sheet${i + 1}.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>`).join("")}</Types>`),
    "_rels/.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/></Relationships>`),
    "xl/workbook.xml": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"><sheets>${names.map((n, i) => `<sheet name="${esc(n)}" sheetId="${i + 1}" r:id="rId${i + 1}"/>`).join("")}</sheets>${defined ? `<definedNames>${defined}</definedNames>` : ""}</workbook>`),
    "xl/_rels/workbook.xml.rels": strToU8(`<?xml version="1.0" encoding="UTF-8" standalone="yes"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">${sheets.map((_, i) => `<Relationship Id="rId${i + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet${i + 1}.xml"/>`).join("")}<Relationship Id="rId${sheets.length + 1}" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/styles" Target="styles.xml"/></Relationships>`),
    "xl/styles.xml": strToU8(styles),
  };
  sheets.forEach((s, i) => { files[`xl/worksheets/sheet${i + 1}.xml`] = strToU8(sheetXml(s)); });
  return zipSync(files, { level: 6 });
}
