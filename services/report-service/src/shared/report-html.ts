/**
 * Safe HTML for the report render pipeline.
 *
 * The render consumer hands this HTML to headless Chromium (@civitasone/render
 * pdf.ts, page.setContent) with network access. Report/template names and data
 * sources are user-controlled, so interpolating them raw let a name such as
 * `<img src=http://169.254.169.254/...>` or an <iframe>/<link> make the
 * renderer fetch internal URLs (SSRF) or local files.
 *
 *  1. escapeHtml(): every interpolated value is escaped (& < > " ').
 *  2. withRenderSandbox(): defence in depth applied at the render choke point.
 *     A Content-Security-Policy that allows NO network or file loads (only
 *     inline styles and data: images/fonts) and no script, so even HTML that
 *     escaped (1) cannot make Chromium fetch anything or run JavaScript.
 *     The meta is prepended before any markup: the HTML parser places a <meta>
 *     that precedes <html> into the implied <head>, so it is in force before
 *     any later element is parsed.
 */

export function escapeHtml(value: unknown): string {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const RENDER_CSP = [
  "default-src 'none'",
  "script-src 'none'",
  "connect-src 'none'",
  "frame-src 'none'",
  "child-src 'none'",
  "object-src 'none'",
  "img-src data:",
  "font-src data:",
  "style-src 'unsafe-inline'",
  "base-uri 'none'",
  "form-action 'none'",
].join("; ");

const CSP_META = `<meta http-equiv="Content-Security-Policy" content="${RENDER_CSP}">`;

/** Prefix the document with the no-network / no-script CSP. Idempotent. */
export function withRenderSandbox(html: string): string {
  if (html.startsWith(CSP_META)) return html;
  return `${CSP_META}${html}`;
}

/** Placeholder document for an ad-hoc report job (jobs consumer). */
export function buildJobReportHtml(name: string, reportType: string | null | undefined, generatedAt: Date): string {
  return `<html><body><h1>${escapeHtml(name)}</h1><p>Report type: ${escapeHtml(reportType ?? "general")}</p><p>Generated at: ${escapeHtml(generatedAt.toISOString())}</p></body></html>`;
}

/** Placeholder document for a template execution (templates consumer). */
export function buildTemplateReportHtml(name: string, dataSourceId: string, generatedAt: Date): string {
  return `<html><body><h1>${escapeHtml(name)}</h1><p>Data source: ${escapeHtml(dataSourceId)}</p><p>Generated at: ${escapeHtml(generatedAt.toISOString())}</p></body></html>`;
}
