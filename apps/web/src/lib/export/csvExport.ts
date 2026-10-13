/**
 * W1 SF-08: the ONE place a CSV file leaves the browser, and the ONE audit
 * client for it.
 *
 *  - `downloadCsvFile` is the only code allowed to build a CSV Blob
 *    (`csvExportGuard.test.ts` fails the build on a `new Blob(` CSV anywhere else).
 *  - `tableExportGuard` records the export in the audit trail BEFORE any file is
 *    built and is FAIL-CLOSED: a rejected, failed or unreachable audit call
 *    returns `{ ok: false }` and no file is created. It never carries a status
 *    code or the server's own text.
 *  - `runAuditedCsvExport` is `guard -> build -> download` for hand-rolled
 *    exports that cannot use DataTable's own export.
 */
export type ExportVerdict = { ok: true } | { ok: false; message: string };
export type ExportInfo = { rowCount: number; filter: string };
export type ExportGuard = (info: ExportInfo) => Promise<ExportVerdict>;

export const TABLE_EXPORT_AUDIT_URL = "/api/proxy/v1/admin/table-exports/audit";
export const TABLE_EXPORT_NOT_RECORDED = "Couldn't record this export in the audit trail, so no file was created. Try again.";

/** Resource key: lower-case path-like slug, e.g. "finance/treasury/cheques". Must match admin-service's route validation. */
export const EXPORT_RESOURCE_PATTERN = /^[a-z0-9][a-z0-9/_-]{0,99}$/;

export function tableExportGuard(resource: string, notRecorded: string = TABLE_EXPORT_NOT_RECORDED): ExportGuard {
  return async (info) => {
    if (!EXPORT_RESOURCE_PATTERN.test(resource)) return { ok: false, message: notRecorded };
    try {
      const res = await fetch(TABLE_EXPORT_AUDIT_URL, {
        method: "POST",
        headers: { "content-type": "application/json" },
        credentials: "same-origin",
        body: JSON.stringify({ resource, rowCount: info.rowCount, filtered: info.filter.trim().length > 0 }),
      });
      return res.ok ? { ok: true } : { ok: false, message: notRecorded };
    } catch {
      return { ok: false, message: notRecorded };
    }
  };
}

/**
 * POST an export-audit body to a resource-specific route and map the answer to a
 * fail-closed verdict (any non-2xx or network failure => `ok: false`). Used by the
 * per-service export-audit routes (loans, devices, GST ledger, ...).
 */
export async function postExportAudit(url: string, body: Record<string, unknown>, notRecorded: string = TABLE_EXPORT_NOT_RECORDED): Promise<ExportVerdict> {
  try {
    const res = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify(body),
    });
    return res.ok ? { ok: true } : { ok: false, message: notRecorded };
  } catch {
    return { ok: false, message: notRecorded };
  }
}

/** Build a CSV Blob and trigger the browser download. The only CSV Blob constructor in the web app. */
export function downloadCsvFile(filename: string, csv: string): void {
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  a.click();
  URL.revokeObjectURL(url);
}

/** Audit first (fail-closed), then build and download. Resolves to the verdict; on `ok: false` no file was built. */
export async function runAuditedCsvExport(opts: {
  guard: ExportGuard;
  rowCount: number;
  filter?: string;
  filename: string;
  build: () => string | Promise<string>;
}): Promise<ExportVerdict> {
  let verdict: ExportVerdict;
  try {
    verdict = await opts.guard({ rowCount: opts.rowCount, filter: opts.filter ?? "" });
  } catch {
    verdict = { ok: false, message: TABLE_EXPORT_NOT_RECORDED };
  }
  if (!verdict.ok) return verdict;
  downloadCsvFile(opts.filename, await opts.build());
  return { ok: true };
}
