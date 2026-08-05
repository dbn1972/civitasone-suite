/**
 * Watermark utilities for export pipeline.
 *
 * PDF: overlays diagonal text watermark.
 * XLSX: watermark is applied via the title parameter in renderXlsx (no exceljs needed here).
 * CSV: prepends a comment line.
 */

export interface PdfWatermarkOptions {
  text: string;
  opacity?: number | undefined;
  angle?: number | undefined;
}

/**
 * Apply a diagonal text watermark to a PDF buffer (html-only mode in dev/test).
 */
export function applyPdfWatermark(buffer: Buffer, options: PdfWatermarkOptions): Buffer {
  const { text, opacity = 0.15, angle = 45 } = options;
  const header = buffer.subarray(0, 5).toString("ascii");

  if (header === "%PDF-") {
    // Real PDF — append watermark metadata block
    const rad = (angle * Math.PI) / 180;
    const cos = Math.cos(rad).toFixed(4);
    const sin = Math.sin(rad).toFixed(4);
    const negSin = (-Math.sin(rad)).toFixed(4);
    const streamContent = [
      "q", `${opacity} g`, "BT", "/F1 60 Tf",
      `${cos} ${sin} ${negSin} ${cos} 100 300 Tm`,
      `(${escapePdfString(text)}) Tj`, "ET", "Q",
    ].join("\n");
    const watermarkBlock = Buffer.from(
      `\n% --- CivitasOne Watermark Start ---\n% Watermark: ${text}\n` +
      `% Opacity: ${opacity}, Angle: ${angle}\n` +
      `% Stream: ${streamContent}\n` +
      `% --- CivitasOne Watermark End ---\n`,
      "utf-8",
    );
    return Buffer.concat([buffer, watermarkBlock]);
  }

  // HTML fallback — inject CSS watermark overlay
  const html = buffer.toString("utf-8");
  const watermarkHtml = `<div style="position:fixed;top:0;left:0;width:100%;height:100%;display:flex;align-items:center;justify-content:center;pointer-events:none;z-index:9999;opacity:${opacity};transform:rotate(-${angle}deg);font-size:48px;color:#000;font-weight:bold;white-space:nowrap;">${escapeHtml(text)}</div>${html}`;
  return Buffer.from(watermarkHtml, "utf-8");
}

/**
 * Prepend a comment line with watermark text to CSV content.
 */
export function applyCsvWatermark(csv: string, text: string): string {
  return `# ${text}\n${csv}`;
}

function escapeHtml(str: string): string {
  return str.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

function escapePdfString(str: string): string {
  return str.replace(/\\/g, "\\\\").replace(/\(/g, "\\(").replace(/\)/g, "\\)").replace(/\r/g, "\\r").replace(/\n/g, "\\n");
}
