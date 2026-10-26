/**
 * GAP-REPORTS-LIST-04: report-service no longer returns the presigned bearer
 * URL in job payloads; it returns the authorising download endpoint path
 * (`/v1/reports/jobs/:id/download`, owner-checked and audited). The browser
 * reaches it through the same-origin proxy. Anything else (an absolute URL,
 * a path outside the reports download route) is refused so a raw bearer link
 * is never rendered.
 */
const DOWNLOAD_PATH_RE = /^\/v1\/reports\/jobs\/[0-9A-Za-z-]+\/download$/;

export function reportDownloadHref(downloadUrl: string | null | undefined): string | null {
  if (!downloadUrl || !DOWNLOAD_PATH_RE.test(downloadUrl)) return null;
  return `/api/proxy${downloadUrl}`;
}
