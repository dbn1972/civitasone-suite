import qrcode from "qrcode-generator";

/**
 * GAP-ASSETS-DETAIL-03: a real, scannable QR code for the asset tag.
 *
 * The code's text is only ever an INPUT to the encoder. The output is a path built from integers, set via
 * setAttribute / createElementNS, so no user-controlled text is parsed as markup anywhere.
 */
export function qrMatrix(text: string): boolean[][] {
  // typeNumber 0 = auto-size; error-correction level M (~15% recoverable) suits a printed label.
  const qr = qrcode(0, "M");
  qr.addData(text, "Byte");
  qr.make();
  const n = qr.getModuleCount();
  const rows: boolean[][] = [];
  for (let r = 0; r < n; r++) {
    const row: boolean[] = [];
    for (let c = 0; c < n; c++) row.push(qr.isDark(r, c));
    rows.push(row);
  }
  return rows;
}

const SVG_NS = "http://www.w3.org/2000/svg";

/** An SVG element drawing `text` as a QR code (with the 4-module quiet zone the spec requires). */
export function createQrSvg(doc: Document, text: string, sizePx = 200): SVGSVGElement {
  const matrix = qrMatrix(text);
  const quiet = 4;
  const dim = matrix.length + quiet * 2;
  let d = "";
  matrix.forEach((row, r) => {
    row.forEach((dark, c) => {
      if (dark) d += `M${c + quiet} ${r + quiet}h1v1h-1z`;
    });
  });
  const svg = doc.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", `0 0 ${dim} ${dim}`);
  svg.setAttribute("width", String(sizePx));
  svg.setAttribute("height", String(sizePx));
  svg.setAttribute("role", "img");
  svg.setAttribute("aria-label", "QR code for the asset tag");
  svg.setAttribute("shape-rendering", "crispEdges");
  const bg = doc.createElementNS(SVG_NS, "rect");
  bg.setAttribute("width", String(dim));
  bg.setAttribute("height", String(dim));
  bg.setAttribute("fill", "#fff");
  const path = doc.createElementNS(SVG_NS, "path");
  path.setAttribute("d", d);
  path.setAttribute("fill", "#000");
  svg.appendChild(bg);
  svg.appendChild(path);
  return svg;
}
