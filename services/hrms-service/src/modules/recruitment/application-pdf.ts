/**
 * Downloadable submitted-application copy (checklist R-RA-0105) — pure HTML build.
 *
 * Produces a candidate-facing copy of the submitted application: the candidate's
 * OWN submitted data only. It deliberately excludes internal screening artefacts
 * (decision, reason codes, remarks, scores, screener identity) — a candidate
 * copy is not a screening report. All interpolated values are HTML-escaped, so a
 * hostile applicant_name/qualification cannot inject markup into the rendered PDF.
 */

/** Escape the five HTML-significant characters (XSS / markup-injection guard). */
export function escapeHtml(v: unknown): string {
  const s = v === null || v === undefined ? "" : String(v);
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export interface ApplicationPdfInput {
  id: string;
  applicantName: string;
  applicationNo?: string | null;
  vacancyTitle?: string | null;
  vacancyRef?: string | null;
  category?: string | null;
  qualification?: string | null;
  experienceYears?: number | null;
  status?: string | null;
  appliedAt?: Date | string | null;
}

function fmtDate(d: Date | string | null | undefined): string {
  if (!d) return "—";
  const dt = typeof d === "string" ? new Date(d) : d;
  return Number.isNaN(dt.getTime()) ? "—" : dt.toISOString().slice(0, 10);
}

/** Build the self-contained HTML for the application copy (fed to renderPdf). */
export function buildApplicationHtml(a: ApplicationPdfInput): string {
  const row = (label: string, val: unknown) =>
    `<tr><td class="k">${escapeHtml(label)}</td><td class="v">${escapeHtml(val ?? "—")}</td></tr>`;
  return `<!DOCTYPE html>
<html lang="en"><head><meta charset="utf-8"/>
<meta http-equiv="Content-Security-Policy" content="default-src 'none'; style-src 'unsafe-inline'"/>
<title>Application ${escapeHtml(a.applicationNo ?? a.id)}</title>
<style>
body{font-family:Arial,sans-serif;max-width:800px;margin:0 auto;padding:24px;font-size:13px;color:#111}
h1{font-size:18px;text-align:center;margin-bottom:4px} .sub{text-align:center;color:#555;margin-bottom:20px}
table{width:100%;border-collapse:collapse;margin:8px 0}
td{border:1px solid #ccc;padding:6px 10px;vertical-align:top}
td.k{width:32%;background:#f5f5f5;font-weight:bold}
.foot{margin-top:24px;color:#666;font-size:11px;text-align:center}
</style></head><body>
<h1>Application Copy</h1>
<div class="sub">${escapeHtml(a.vacancyTitle ?? "Vacancy")}${a.vacancyRef ? ` (${escapeHtml(a.vacancyRef)})` : ""}</div>
<table>
${row("Application No", a.applicationNo ?? a.id)}
${row("Candidate", a.applicantName)}
${row("Category", a.category)}
${row("Qualification", a.qualification)}
${row("Experience (years)", a.experienceYears)}
${row("Status", a.status)}
${row("Applied On", fmtDate(a.appliedAt))}
</table>
<div class="foot">This is a system-generated copy of your submitted application. It does not disclose internal evaluation details.</div>
</body></html>`;
}
