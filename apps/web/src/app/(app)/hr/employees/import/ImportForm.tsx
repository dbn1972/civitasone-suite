"use client";

import { useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { Button } from "../../../../_components/ds";

type Row = Record<string, string> & { lineNo: number };

// Hoisted so the handleSubmit validation and the JSX hint text below share
// one list instead of two independently-maintained copies drifting apart.
const REQUIRED_COLUMNS = ["employeeNo", "fullName", "departmentCode", "designationCode", "employeeType", "dateOfJoining", "basicPay"];
// GAP-HR-EMPLOYEES-IMPORT-05: optional, resolved server-side (bulk-import/
// routes.ts) from an existing employee's number to a real managerId -- not
// a required column, so omitting it (most rows) is fine.
const OPTIONAL_COLUMNS = ["managerEmployeeNo"];

// GAP-HR-EMPLOYEES-IMPORT-03: the previous `line.split(",")` shifted every
// later column whenever a value legitimately contained a comma (a quoted
// "Das, Rashmi Ranjan" name, or a thousands-separated amount) -- this is a
// minimal RFC 4180 reader (quoted fields, embedded commas, "" as an escaped
// quote) rather than a dependency, since this file only ever needs to read
// one flat CSV shape.
function parseCsvLine(line: string): string[] {
  const cells: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < line.length; i++) {
    const c = line[i];
    if (inQuotes) {
      if (c === '"') {
        if (line[i + 1] === '"') { cur += '"'; i++; } else { inQuotes = false; }
      } else {
        cur += c;
      }
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ",") {
      cells.push(cur);
      cur = "";
    } else {
      cur += c;
    }
  }
  cells.push(cur);
  return cells.map((c) => c.trim());
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
const GENDER_VALUES = new Set(["male", "female", "other", ""]);

// The bulk endpoint (POST /v1/hrms/employees/bulk) caps a single request at
// 500 employees (bulkImportBody in hrms-service's bulk-import/routes.ts).
const BULK_MAX_PER_REQUEST = 500;

type ResolvedRow = {
  lineNo: number;
  fullName: string;
  body: Record<string, unknown>;
};

/**
 * Bulk CSV import form — parses the file client-side, validates rows, then
 * submits them to the backend. Shows progress and error summary.
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
  const [status, setStatus] = useState<"idle" | "parsing" | "uploading" | "done" | "error">("idle");
  const [progress, setProgress] = useState({ total: 0, success: 0, failed: 0 });
  const [errors, setErrors] = useState<string[]>([]);
  // GAP-HR-EMPLOYEES-IMPORT-06: structured alongside the plain display
  // strings above (which stay exactly as before, so the existing on-screen
  // wording/tests are untouched) so a real CSV can be built from them --
  // the display strings themselves are already fully-formed sentences, not
  // suitable for re-splitting into columns.
  const [errorRows, setErrorRows] = useState<{ lineNo: number; fullName: string; message: string }[]>([]);
  const formError = useFormError("employee row");

  function downloadErrorReport() {
    const csvLines = [
      "lineNo,fullName,message",
      ...errorRows.map((r) => [r.lineNo, `"${r.fullName.replace(/"/g, '""')}"`, `"${r.message.replace(/"/g, '""')}"`].join(",")),
    ];
    const blob = new Blob([csvLines.join("\n")], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = "import-errors.csv";
    a.click();
    URL.revokeObjectURL(url);
  }

  async function loadCodeMap(path: string): Promise<Map<string, string>> {
    const res = await fetch(path);
    if (!res.ok) return new Map();
    const body = (await res.json()) as { data?: { id: string; code: string }[] } | { id: string; code: string }[];
    const rows = Array.isArray(body) ? body : (body.data ?? []);
    return new Map(rows.map((r) => [r.code, r.id]));
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    const file = fileRef.current?.files?.[0];
    if (!file) { setStatus("error"); setErrors([t("errSelectFile")]); return; }

    setStatus("parsing");
    setErrors([]);
    setErrorRows([]);
    const text = await file.text();
    // GAP-HR-EMPLOYEES-IMPORT-03: a header-only BOM/CRLF is trimmed by the
    // same per-line .trim() already used below; splitting on "\n" alone
    // (not a full line-based CSV tokenizer) is unaffected by CRLF since the
    // trailing \r ends up trimmed too.
    const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
    if (lines.length < 2) { setStatus("error"); setErrors([t("errMinRows")]); return; }

    const headers = parseCsvLine(lines[0]);
    const missing = REQUIRED_COLUMNS.filter((c) => !headers.includes(c));
    if (missing.length) { setStatus("error"); setErrors([t("errMissingColumns", { columns: missing.join(", ") })]); return; }

    // Parse rows. `lineNo` (number) deliberately sits alongside the
    // Record<string, string> CSV-column fields, which the index signature
    // can't express — building it as `any` here is the narrowest way to
    // bridge that, matching how this file already handled it.
    // GAP-HR-EMPLOYEES-IMPORT-03: a row whose cell count doesn't match the
    // header count (e.g. an unquoted embedded comma still shifting columns,
    // or a short/ragged line) is now flagged as its own error instead of
    // being silently padded with "" for the missing trailing columns.
    const errs: string[] = [];
    const errRows: { lineNo: number; fullName: string; message: string }[] = [];
    const rows: Row[] = [];
    lines.slice(1).forEach((line, idx) => {
      const lineNo = idx + 2;
      const vals = parseCsvLine(line);
      if (vals.length !== headers.length) {
        const fullNameGuess = vals[headers.indexOf("fullName")] ?? "";
        const msg = t("errColumnCountRow", { lineNo, expected: headers.length, found: vals.length });
        errs.push(msg);
        errRows.push({ lineNo, fullName: fullNameGuess, message: msg });
        return;
      }
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const obj = { lineNo } as any;
      headers.forEach((h, i) => { obj[h] = vals[i] ?? ""; });
      rows.push(obj as Row);
    });

    const [deptByCode, desigByCode] = await Promise.all([
      loadCodeMap("/api/proxy/v1/hrms/departments"),
      loadCodeMap("/api/proxy/v1/hrms/designations"),
    ]);

    setStatus("uploading");
    setProgress({ total: rows.length, success: 0, failed: errs.length });
    let success = 0;

    // Resolve codes to ids and validate client-side (see header comment) --
    // rows an unknown code or an invalid field makes un-submittable are
    // reported here and never sent, rather than silently reaching the
    // server as NaN/garbage (GAP-HR-EMPLOYEES-IMPORT-03: basicPay in
    // particular used to become NaN -> null on any non-numeric input).
    const resolved: ResolvedRow[] = [];
    for (const row of rows) {
      const departmentId = deptByCode.get(row.departmentCode);
      const designationId = desigByCode.get(row.designationCode);
      const rowErrors: string[] = [];
      if (!departmentId) rowErrors.push(t("errUnknownDept", { code: row.departmentCode }));
      if (!designationId) rowErrors.push(t("errUnknownDesig", { code: row.designationCode }));
      if (row.dateOfJoining && !DATE_RE.test(row.dateOfJoining)) rowErrors.push(t("errInvalidDate", { value: row.dateOfJoining }));
      if (row.gender && !GENDER_VALUES.has(row.gender)) rowErrors.push(t("errInvalidGender", { value: row.gender }));
      const basicMinorStr = rupeesToMinorString(row.basicPay ?? "");
      if (!basicMinorStr) rowErrors.push(t("errInvalidBasicPay", { value: row.basicPay }));

      if (rowErrors.length > 0) {
        const bad = rowErrors.join(t("andJoiner"));
        const msg = t("errUnknownRow", { lineNo: row.lineNo, fullName: row.fullName, bad });
        errs.push(msg);
        errRows.push({ lineNo: row.lineNo, fullName: row.fullName, message: bad });
        continue;
      }
      resolved.push({
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
    setProgress({ total: rows.length, success, failed: errs.length });

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
        setProgress({ total: rows.length, success, failed: errs.length });
        return;
      }

      if (res.ok || res.status === 202) {
        // Accepted and queued for async creation — see header comment on why
        // this isn't the same guarantee the old per-row synchronous calls
        // gave. Counted the same way ("success") as before: this form has
        // never had a way to represent "queued but unconfirmed" separately.
        success += chunk.length;
        setProgress({ total: rows.length, success, failed: errs.length });
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
        setProgress({ total: rows.length, success, failed: errs.length });
        return;
      }

      const badIdx = new Set(perRow.map((x) => x.idx));
      for (const { row, message } of perRow) {
        errs.push(t("errRowSave", { lineNo: row.lineNo, fullName: row.fullName, message }));
        errRows.push({ lineNo: row.lineNo, fullName: row.fullName, message });
      }
      setProgress({ total: rows.length, success, failed: errs.length });

      const goodRows = chunk.filter((_, i) => !badIdx.has(i));
      await submitChunk(goodRows);
    }

    for (let i = 0; i < resolved.length; i += BULK_MAX_PER_REQUEST) {
      await submitChunk(resolved.slice(i, i + BULK_MAX_PER_REQUEST));
    }

    setErrors(errs);
    setErrorRows(errRows);
    setStatus("done");
  }

  return (
    <form onSubmit={handleSubmit}>
      <div style={{ display: "grid", gap: 6, marginBottom: 12 }}>
        <label htmlFor="import-csv-file" style={{ fontSize: 13, fontWeight: 500, color: "var(--fg, #0f172a)" }}>
          {t("fileLabel")} <span style={{ color: "var(--bad, #ef4444)" }}>*</span>
        </label>
        <input
          ref={fileRef}
          id="import-csv-file"
          type="file"
          accept=".csv,text/csv"
          aria-describedby="import-csv-hint"
        />
        <p id="import-csv-hint" style={{ fontSize: 12, color: "var(--mut, #64748b)", margin: 0 }}>
          {t("requiredColumnsHint", { columns: REQUIRED_COLUMNS.join(", ") })}
        </p>
        <p style={{ fontSize: 12, color: "var(--mut, #64748b)", margin: 0 }}>
          {t("optionalColumnsHint", { columns: OPTIONAL_COLUMNS.join(", ") })}
        </p>
      </div>
      <div style={{ display: "flex", gap: 10, alignItems: "center" }}>
        <Button type="submit" variant="primary" disabled={status === "uploading"} style={{ minHeight: 44 }}>
          {status === "uploading" ? t("importingProgress", { success: progress.success, total: progress.total }) : t("uploadBtn")}
        </Button>
        {status === "done" && (
          <span style={{ fontSize: 13, color: progress.failed === 0 ? "var(--good, #166534)" : "var(--bad, #b91c1c)" }}>
            {t("resultImported", { success: progress.success })}
            {progress.failed > 0 ? t("resultFailedSuffix", { failed: progress.failed }) : ""}
          </span>
        )}
      </div>
      {errors.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div style={{ padding: "10px 14px", borderRadius: 8, background: "var(--badbg, #fef2f2)", border: "1px solid var(--badbd, #fecaca)", fontSize: 12.5, color: "var(--bad, #b91c1c)", maxHeight: 200, overflow: "auto" }}>
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
