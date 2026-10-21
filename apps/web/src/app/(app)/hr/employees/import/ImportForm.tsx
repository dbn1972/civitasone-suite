"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";
import { Button, Field, Input } from "../../../../_components/ds";
import { downloadCsvFile } from "@/lib/export/csvExport";
import { parseCsv } from "./csv";

type Row = Record<string, string> & { lineNo: number };

// Hoisted so the review-step validation and the JSX hint text below share
// one list instead of two independently-maintained copies drifting apart.
const REQUIRED_COLUMNS = ["employeeNo", "fullName", "departmentCode", "designationCode", "employeeType", "dateOfJoining", "basicPay"];
// GAP-HR-EMPLOYEES-IMPORT-05: optional, resolved server-side (bulk-import/
// routes.ts) from an existing employee's number to a real managerId -- not
// a required column, so omitting it (most rows) is fine.
const OPTIONAL_COLUMNS = ["managerEmployeeNo"];

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
// Same shape the Add Employee wizard accepts (new/wizardTypes.ts MOBILE_RE),
// so the two entry paths agree on what a valid mobile number looks like.
const MOBILE_RE = /^\+?[\d\s\-()]{7,15}$/;
const GENDER_VALUES = new Set(["male", "female", "other", ""]);

// The bulk endpoint (POST /v1/hrms/employees/bulk) caps a single request at
// 500 employees (bulkImportBody in hrms-service's bulk-import/routes.ts).
const BULK_MAX_PER_REQUEST = 500;
// GAP-HR-EMPLOYEES-IMPORT-03 (fix step 4): the review step shows the first
// few rows of the file so a person can see at a glance that the columns lined
// up, without rendering a 500-row table.
const PREVIEW_ROWS = 10;

/** A YYYY-MM-DD string that is also a real calendar date (2024-13-45 and 2023-02-30 are not). */
function isRealIsoDate(value: string): boolean {
  if (!DATE_RE.test(value)) return false;
  const [y, m, d] = value.split("-").map(Number) as [number, number, number];
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

type ResolvedRow = {
  lineNo: number;
  fullName: string;
  body: Record<string, unknown>;
};

type ErrorRow = { lineNo: number; fullName: string; message: string };

type PreviewRow = {
  lineNo: number;
  employeeNo: string;
  fullName: string;
  departmentCode: string;
  designationCode: string;
  dateOfJoining: string;
  basicPay: string;
  ok: boolean;
};

/**
 * GAP-HR-EMPLOYEES-IMPORT-03: what the review step hands to the confirm step.
 * Nothing in here has been sent to the server yet.
 */
type Review = {
  /** Data rows read from the file (header excluded). */
  fileRows: number;
  /** Rows that passed every client-side check and will be posted on confirm. */
  valid: ResolvedRow[];
  /** The first PREVIEW_ROWS rows of the file, valid or not, for the on-screen table. */
  sample: PreviewRow[];
  /** Plain-language messages for every row that will be skipped. */
  errs: string[];
  errRows: ErrorRow[];
};

type Phase = "idle" | "parsing" | "preview" | "uploading" | "done" | "error";

/**
 * Bulk CSV import form -- two deliberate steps:
 *
 *  1. REVIEW (GAP-HR-EMPLOYEES-IMPORT-03): parse the file (RFC 4180, see
 *     csv.ts), resolve department/designation codes, validate every row
 *     client-side, and show a preview -- the first rows, the total, how many
 *     are valid and how many will be skipped. NOTHING is sent to the server
 *     in this step.
 *  2. CONFIRM: only an explicit "Import N valid rows" click posts the valid
 *     rows (rows with errors are skipped, never posted).
 *
 * departmentId/designationId on both POST /v1/hrms/employees and POST
 * /v1/hrms/employees/bulk are strict UUIDs (createEmployeeBody and
 * bulkImportBody in hrms-service) — neither does any code-based resolution
 * server-side. The CSV template this page hands out uses human codes like
 * "FIN"/"JC" in departmentCode/designationCode, so this form resolves codes
 * to ids client-side against the same masters lists the rest of HR already
 * uses, with a clear per-row error when a code isn't found (rather than a
 * bare status code). This step stays even though submission below now goes
 * through the bulk endpoint — that endpoint expects ids too.
 *
 * FINDING-2 (HRMS role-based review): submission used to be one
 * POST /v1/hrms/employees call per row (a working fix for the code-vs-id
 * 400 above, but it left the dedicated bulk endpoint entirely unused). Now
 * resolved rows are sent to POST /v1/hrms/employees/bulk in chunks of up to
 * BULK_MAX_PER_REQUEST — one request per chunk instead of one per row, so a
 * typical import (well under 500 rows) is a single request. The bulk
 * endpoint validates the whole chunk before queueing any of it (duplicate
 * employeeNo within the file, unknown employeeType, malformed fields), so a
 * chunk-level 400 is resolved per-row via its `fieldErrors` (field:
 * "employees.<index>.<field>") and only the bad rows are dropped before
 * retrying the rest of that chunk — a network-chunk boundary never fails an
 * otherwise-good row.
 *
 * One thing this cannot promise that the old per-row calls could: the
 * single-row endpoint writes synchronously (commands.createEmployee inserts
 * directly), so a 2xx meant "the row is in the database". The bulk endpoint
 * only validates synchronously and then queues actual creation
 * (hrms.employee.create, consumed by employee/consumer.ts) — a 2xx here
 * means "accepted and queued", not yet "confirmed written". The bulk
 * endpoint's own status-polling route (GET .../bulk/status/:batchId) is not
 * wired to real per-row state (see that route's own comment in
 * bulk-import/routes.ts), so there is currently no way to poll for stronger
 * confirmation than this — flagged as a follow-up, not solved here.
 */
export function ImportForm() {
  const t = useTranslations("employeeImportForm");
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<Phase>("idle");
  const [progress, setProgress] = useState({ total: 0, success: 0, failed: 0 });
  const [errors, setErrors] = useState<string[]>([]);
  // GAP-HR-EMPLOYEES-IMPORT-06: structured alongside the plain display
  // strings above (which stay exactly as before, so the existing on-screen
  // wording/tests are untouched) so a real CSV can be built from them --
  // the display strings themselves are already fully-formed sentences, not
  // suitable for re-splitting into columns.
  const [errorRows, setErrorRows] = useState<ErrorRow[]>([]);
  const [review, setReview] = useState<Review | null>(null);
  const formError = useFormError("employee row");

  function downloadErrorReport() {
    const csvLines = [
      "lineNo,fullName,message",
      ...errorRows.map((r) => [r.lineNo, `"${r.fullName.replace(/"/g, '""')}"`, `"${r.message.replace(/"/g, '""')}"`].join(",")),
    ];
    downloadCsvFile("import-errors.csv", csvLines.join("\n"));
  }

  /** null = the master could not be loaded (distinct from "loaded, and empty"). */
  async function loadCodeMap(path: string): Promise<Map<string, string> | null> {
    try {
      const res = await fetch(path);
      if (!res.ok) return null;
      const body = (await res.json()) as { data?: { id: string; code: string }[] } | { id: string; code: string }[];
      const rows = Array.isArray(body) ? body : (body.data ?? []);
      return new Map(rows.map((r) => [r.code, r.id]));
    } catch {
      return null;
    }
  }

  /** Picking a different file discards any review/result from the previous one. */
  function resetForNewFile() {
    setStatus("idle");
    setReview(null);
    setErrors([]);
    setErrorRows([]);
    setProgress({ total: 0, success: 0, failed: 0 });
  }

  async function handleReview(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setStatus("error"); setErrors([t("errSelectFile")]); return; }

    setStatus("parsing");
    setErrors([]);
    setErrorRows([]);
    setReview(null);
    const text = await file.text();
    // GAP-HR-EMPLOYEES-IMPORT-03: the whole text is read as one RFC 4180
    // stream (csv.ts) rather than split on "\n" first, so a quoted value
    // that contains a comma OR a line break stays in one cell; a BOM and
    // CRLF line endings are handled there too.
    const { records, unterminatedQuoteLine } = parseCsv(text);
    if (unterminatedQuoteLine !== null) {
      setStatus("error");
      setErrors([t("errUnterminatedQuote", { lineNo: unterminatedQuoteLine })]);
      return;
    }
    if (records.length < 2) { setStatus("error"); setErrors([t("errMinRows")]); return; }

    const headers = (records[0] as { cells: string[] }).cells;
    const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
    if (missing.length) { setStatus("error"); setErrors([t("errMissingColumns", { columns: missing.join(", ") })]); return; }

    const [deptByCode, desigByCode] = await Promise.all([
      loadCodeMap("/api/proxy/v1/hrms/departments"),
      loadCodeMap("/api/proxy/v1/hrms/designations"),
    ]);
    // A master that could not be loaded must not read as "every code in your
    // file is wrong" -- that would put a transient fetch failure on the
    // person's spreadsheet.
    if (!deptByCode || !desigByCode) { setStatus("error"); setErrors([t("errLoadMasters")]); return; }

    const errs: string[] = [];
    const errRows: ErrorRow[] = [];
    const valid: ResolvedRow[] = [];
    const sample: PreviewRow[] = [];
    const firstLineOfEmployeeNo = new Map<string, number>();
    const dataRecords = records.slice(1);

    for (const rec of dataRecords) {
      const lineNo = rec.lineNo;
      const vals = rec.cells;
      const pushSample = (p: Omit<PreviewRow, "lineNo">) => {
        if (sample.length < PREVIEW_ROWS) sample.push({ lineNo, ...p });
      };

      // GAP-HR-EMPLOYEES-IMPORT-03: a row whose cell count doesn't match the
      // header count (e.g. an unquoted embedded comma still shifting columns,
      // or a short/ragged line) is flagged as its own error instead of being
      // silently padded with "" for the missing trailing columns.
      if (vals.length !== headers.length) {
        const fullNameGuess = vals[headers.indexOf("fullName")] ?? "";
        const msg = t("errColumnCountRow", { lineNo, expected: headers.length, found: vals.length });
        errs.push(msg);
        errRows.push({ lineNo, fullName: fullNameGuess, message: msg });
        pushSample({
          employeeNo: vals[headers.indexOf("employeeNo")] ?? "", fullName: fullNameGuess,
          departmentCode: "", designationCode: "", dateOfJoining: "", basicPay: "", ok: false,
        });
        continue;
      }

      // `lineNo` (number) deliberately sits alongside the Record<string,
      // string> CSV-column fields, which the index signature can't express.
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = { lineNo } as any;
      headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
      const row = obj as Row;

      // Resolve codes to ids and validate client-side (see header comment) --
      // rows an unknown code or an invalid field makes un-submittable are
      // reported here and never sent, rather than silently reaching the
      // server as NaN/garbage (GAP-HR-EMPLOYEES-IMPORT-03: basicPay in
      // particular used to become NaN -> null on any non-numeric input).
      const departmentId = deptByCode.get(row.departmentCode);
      const designationId = desigByCode.get(row.designationCode);
      const rowErrors: string[] = [];
      if (!row.employeeNo) rowErrors.push(t("errRequiredField", { field: "employeeNo" }));
      if (!row.fullName) rowErrors.push(t("errRequiredField", { field: "fullName" }));
      if (row.employeeNo) {
        const firstLine = firstLineOfEmployeeNo.get(row.employeeNo);
        if (firstLine !== undefined) rowErrors.push(t("errDuplicateEmployeeNo", { value: row.employeeNo, firstLine }));
        else firstLineOfEmployeeNo.set(row.employeeNo, lineNo);
      }
      if (!row.departmentCode) rowErrors.push(t("errRequiredField", { field: "departmentCode" }));
      else if (!departmentId) rowErrors.push(t("errUnknownDept", { code: row.departmentCode }));
      if (!row.designationCode) rowErrors.push(t("errRequiredField", { field: "designationCode" }));
      else if (!designationId) rowErrors.push(t("errUnknownDesig", { code: row.designationCode }));
      if (!row.dateOfJoining) rowErrors.push(t("errRequiredField", { field: "dateOfJoining" }));
      else if (!isRealIsoDate(row.dateOfJoining)) rowErrors.push(t("errInvalidDate", { value: row.dateOfJoining }));
      if (row.gender && !GENDER_VALUES.has(row.gender)) rowErrors.push(t("errInvalidGender", { value: row.gender }));
      // Contact details are PII: the message names the problem and the row, never
      // echoes the value (the on-screen list and the downloadable error report
      // would otherwise carry a person's raw email / phone number).
      if (row.email && !EMAIL_RE.test(row.email)) rowErrors.push(t("errInvalidEmail"));
      if (row.mobile && !MOBILE_RE.test(row.mobile)) rowErrors.push(t("errInvalidMobile"));
      const basicMinorStr = rupeesToMinorString(row.basicPay ?? "");
      if (!basicMinorStr) rowErrors.push(t("errInvalidBasicPay", { value: row.basicPay }));

      pushSample({
        employeeNo: row.employeeNo, fullName: row.fullName,
        departmentCode: row.departmentCode, designationCode: row.designationCode,
        dateOfJoining: row.dateOfJoining,
        basicPay: basicMinorStr ? formatMoney(basicMinorStr) : row.basicPay,
        ok: rowErrors.length === 0,
      });

      if (rowErrors.length > 0) {
        const bad = rowErrors.join(t("andJoiner"));
        errs.push(t("errRowInvalid", { lineNo: row.lineNo, fullName: row.fullName, bad }));
        errRows.push({ lineNo: row.lineNo, fullName: row.fullName, message: bad });
        continue;
      }
      valid.push({
        lineNo: row.lineNo,
        fullName: row.fullName,
        body: {
          employeeNo: row.employeeNo,
          fullName: row.fullName,
          email: row.email || undefined,
          mobile: row.mobile || undefined,
          departmentId,
          designationId,
          employeeType: row.employeeType || "permanent",
          dateOfJoining: row.dateOfJoining,
          basicMinor: Number(basicMinorStr),
          gender: row.gender || undefined,
          // GAP-HR-EMPLOYEES-IMPORT-05
          managerEmployeeNo: row.managerEmployeeNo || undefined,
        },
      });
    }

    // Nothing has been sent. The person decides what happens next.
    setReview({ fileRows: dataRecords.length, valid, sample, errs, errRows });
    setErrors(errs);
    setErrorRows(errRows);
    setProgress({ total: dataRecords.length, success: 0, failed: errs.length });
    setStatus("preview");
  }

  async function handleConfirm() {
    if (!review || review.valid.length === 0) return;
    const { valid: resolved, fileRows } = review;
    // Rows already rejected in the review step carry through to the final tally.
    const errs: string[] = [...review.errs];
    const errRows: ErrorRow[] = [...review.errRows];
    let success = 0;

    setStatus("uploading");
    setProgress({ total: fileRows, success, failed: errs.length });

    // Submit a chunk to the bulk endpoint. On a validation failure with
    // per-row detail, drop the bad rows (reporting each) and retry the rest
    // of the chunk — bounded by the chunk shrinking on every retry, so this
    // always terminates. On any other failure (network error, or a 4xx/5xx
    // with no field-level detail to act on), the whole chunk is reported
    // failed rather than guessed at.
    async function submitChunk(chunk: ResolvedRow[]): Promise<void> {
      if (chunk.length === 0) return;
      let res: Response;
      try {
        res = await fetch("/api/proxy/v1/hrms/employees/bulk", {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ employees: chunk.map((r) => r.body) }),
        });
      } catch {
        for (const r of chunk) {
          const msg = t("errRowNetwork", { lineNo: r.lineNo, fullName: r.fullName });
          errs.push(msg);
          errRows.push({ lineNo: r.lineNo, fullName: r.fullName, message: t("errRowNetworkShort") });
        }
        setProgress({ total: fileRows, success, failed: errs.length });
        return;
      }

      if (res.ok || res.status === 202) {
        // Accepted and queued for async creation — see header comment on why
        // this isn't the same guarantee the old per-row synchronous calls
        // gave. Counted the same way ("success") as before: this form has
        // never had a way to represent "queued but unconfirmed" separately.
        success += chunk.length;
        setProgress({ total: fileRows, success, failed: errs.length });
        return;
      }

      const resolvedErr = await formError.fromResponse(res, "save");
      const perRow = Object.entries(resolvedErr.fieldErrors)
        .map(([field, message]) => {
          const m = /^employees\.(\d+)\./.exec(field);
          const idx = m ? Number(m[1]) : NaN;
          return Number.isInteger(idx) && chunk[idx] ? { idx, row: chunk[idx] as ResolvedRow, message } : null;
        })
        .filter((x): x is { idx: number; row: ResolvedRow; message: string } => x !== null);

      if (perRow.length === 0) {
        // No field-level detail to act on (e.g. an auth/role failure, or a
        // malformed request) — report the whole chunk rather than guessing.
        for (const r of chunk) {
          errs.push(t("errRowSave", { lineNo: r.lineNo, fullName: r.fullName, message: resolvedErr.message }));
          errRows.push({ lineNo: r.lineNo, fullName: r.fullName, message: resolvedErr.message });
        }
        setProgress({ total: fileRows, success, failed: errs.length });
        return;
      }

      const badIdx = new Set(perRow.map((x) => x.idx));
      for (const { row, message } of perRow) {
        errs.push(t("errRowSave", { lineNo: row.lineNo, fullName: row.fullName, message }));
        errRows.push({ lineNo: row.lineNo, fullName: row.fullName, message });
      }
      setProgress({ total: fileRows, success, failed: errs.length });

      const goodRows = chunk.filter((_, i) => !badIdx.has(i));
      await submitChunk(goodRows);
    }

    for (let i = 0; i < resolved.length; i += BULK_MAX_PER_REQUEST) {
      await submitChunk(resolved.slice(i, i + BULK_MAX_PER_REQUEST));
    }

    setErrors(errs);
    setErrorRows(errRows);
    setReview(null);
    setStatus("done");
  }

  const reviewing = status === "preview" && review !== null;
  const validCount = review?.valid.length ?? 0;
  const skippedCount = review ? review.fileRows - validCount : 0;

  return (
    <form noValidate onSubmit={handleReview}>
      <Field id="import-csv-file" label={t("fileLabel")} required style={{ marginBottom: 12 }}>
        <Input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          aria-describedby="import-csv-hint"
          onChange={resetForNewFile}
        />
        <p id="import-csv-hint" style={{ fontSize: 12, color: "var(--mut)", margin: 0 }}>
          {t("requiredColumnsHint", { columns: REQUIRED_COLUMNS.join(", ") })}
        </p>
        <p style={{ fontSize: 12, color: "var(--mut)", margin: 0 }}>
          {t("optionalColumnsHint", { columns: OPTIONAL_COLUMNS.join(", ") })}
        </p>
      </Field>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Button type="submit" variant="primary" disabled={status === "parsing" || status === "uploading"} style={{ minHeight: 44 }}>
          {status === "parsing" ? t("reviewingBtn") : t("reviewBtn")}
        </Button>
        {/* Polite live region, mounted from the start so a screen reader
            announces the review summary / final result when it fills in. */}
        <span
          role="status"
          aria-live="polite"
          style={{ fontSize: 13, color: status === "done" && progress.failed === 0 ? "var(--good)" : status === "done" ? "var(--bad)" : "var(--ink2)" }}
        >
          {reviewing && review
            ? t("previewSummary", { total: review.fileRows, valid: validCount, invalid: skippedCount })
            : status === "done"
              ? <>
                  {t("resultImported", { success: progress.success })}
                  {progress.failed > 0 ? t("resultFailedSuffix", { failed: progress.failed }) : ""}
                </>
              : null}
        </span>
      </div>

      {/* GAP-HR-EMPLOYEES-IMPORT-03: nothing below this point has been sent to
          the server. The explicit confirm button is the only thing that posts. */}
      {(reviewing || status === "uploading") && review && (
        <div style={{ marginTop: 16 }}>
          <p style={{ fontSize: 12.5, color: "var(--mut)", margin: "0 0 8px" }}>{t("previewNote")}</p>
          <div style={{ overflowX: "auto", marginBottom: 8 }}>
            <table className="tbl" style={{ fontSize: 13 }}>
              <caption style={{ textAlign: "start", fontSize: 12, color: "var(--mut)", paddingBottom: 4 }}>
                {t("previewCaption", { shown: review.sample.length, total: review.fileRows })}
              </caption>
              <thead>
                <tr>
                  <th>{t("previewColRow")}</th>
                  <th>employeeNo</th>
                  <th>fullName</th>
                  <th>departmentCode</th>
                  <th>designationCode</th>
                  <th>dateOfJoining</th>
                  <th>basicPay</th>
                  <th>{t("previewColCheck")}</th>
                </tr>
              </thead>
              <tbody>
                {review.sample.map((r) => (
                  <tr key={r.lineNo}>
                    <td>{r.lineNo}</td>
                    <td>{r.employeeNo || "—"}</td>
                    <td>{r.fullName || "—"}</td>
                    <td>{r.departmentCode || "—"}</td>
                    <td>{r.designationCode || "—"}</td>
                    <td>{r.dateOfJoining || "—"}</td>
                    <td>{r.basicPay || "—"}</td>
                    <td style={{ color: r.ok ? "var(--good)" : "var(--bad)" }}>{r.ok ? t("previewRowReady") : t("previewRowSkipped")}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {validCount === 0 && (
            <p role="alert" style={{ fontSize: 13, color: "var(--bad)", margin: "0 0 8px" }}>{t("previewNothingToImport")}</p>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Button
              type="button"
              variant="primary"
              onClick={() => void handleConfirm()}
              disabled={status === "uploading" || validCount === 0}
              style={{ minHeight: 44 }}
            >
              {status === "uploading"
                ? t("importingProgress", { success: progress.success, total: progress.total })
                : t("confirmBtn", { count: validCount })}
            </Button>
            {status !== "uploading" && (
              <Button type="button" variant="ghost" onClick={() => { if (fileRef.current) fileRef.current.value = ""; resetForNewFile(); }} style={{ minHeight: 44 }}>
                {t("cancelReviewBtn")}
              </Button>
            )}
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div role={status === "error" ? "alert" : undefined} style={{ padding: "10px 14px", borderRadius: 8, background: "var(--badbg)", border: "1px solid var(--badbd)", fontSize: 12.5, color: "var(--bad)", maxHeight: 200, overflow: "auto" }}>
            {errors.map((e, i) => <div key={i}>{e}</div>)}
          </div>
          {/* GAP-HR-EMPLOYEES-IMPORT-06: errors only ever lived in local
              component state -- a refresh (or just scrolling past a long
              list) lost them for good, with no way to hand the failed rows
              to someone else to fix. Generated client-side only; nothing
              here is uploaded anywhere. */}
          {errorRows.length > 0 && (
            <Button
              type="button"
              variant="ghost"
              onClick={downloadErrorReport}
              style={{ marginTop: 8, fontSize: 13 }}
            >
              {t("downloadErrorReport")}
            </Button>
          )}
        </div>
      )}
    </form>
  );
}
