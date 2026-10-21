"use client";

import { useEffect, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { Button, Field, Input } from "../../../../_components/ds";
import { downloadCsvFile } from "@/lib/export/csvExport";

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
 * GAP-HR-EMPLOYEES-IMPORT-02: the single-row endpoint writes synchronously,
 * so a 2xx meant "the row is in the database". The bulk endpoint only
 * validates synchronously and then queues creation (hrms.employee.create,
 * consumed by employee/consumer.ts) — a 2xx means "accepted and queued", not
 * "created". Each accepted chunk now returns a batch id whose real per-row
 * state is persisted by the consumer, so after the last chunk this form polls
 * GET .../bulk/status/:batchId (every `pollIntervalMs`, for at most
 * `pollMaxMs`), shows "N submitted" immediately, and only reports "N created"
 * — plus a named, downloadable list of the rows that failed — once every batch
 * reports "completed". If the budget runs out (or the server sent no batch id)
 * the result stays "submitted" and says so; a green "created" is never shown
 * on the strength of a 202 alone.
 *
 * GAP-HR-EMPLOYEES-IMPORT-01: a 403 on any chunk means the caller is not
 * allowed to bulk-import; it is reported once, as a single permission message,
 * and no further chunk is sent.
 */
/** One accepted POST /bulk chunk, kept so its status can be polled and its rows named in the report. */
type AcceptedBatch = { batchId: string; rows: ResolvedRow[] };

type BatchStatus = {
  status: "processing" | "completed";
  total: number;
  created: number;
  failed: number;
  pending: number;
  failedRows: { rowNo: number; employeeNo: string; code: string }[];
};

// Stable failure codes from the status route -> translated reason (never the server's own text).
const ROW_FAILURE_KEYS: Record<string, string> = {
  EMPLOYEE_NO_EXISTS: "rowFailExists",
  INVALID_REFERENCE: "rowFailReference",
  INVALID_VALUE: "rowFailInvalid",
  NOT_QUEUED: "rowFailNotQueued",
};

function parseBatchStatus(raw: unknown): BatchStatus | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Record<string, unknown>;
  const num = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : NaN);
  const total = num(r.total), created = num(r.created), failed = num(r.failed), pending = num(r.pending);
  if ([total, created, failed, pending].some(Number.isNaN)) return null;
  if (r.status !== "processing" && r.status !== "completed") return null;
  const failedRows = Array.isArray(r.failedRows)
    ? (r.failedRows as Record<string, unknown>[])
        .filter((f) => typeof f.rowNo === "number")
        .map((f) => ({ rowNo: f.rowNo as number, employeeNo: String(f.employeeNo ?? ""), code: String(f.code ?? "") }))
    : [];
  return { status: r.status, total, created, failed, pending, failedRows };
}

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** How often, and for how long, an accepted import is polled for its real outcome. */
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_MAX_MS = 60_000;

export function ImportForm({ pollIntervalMs = DEFAULT_POLL_INTERVAL_MS, pollMaxMs = DEFAULT_POLL_MAX_MS }: { pollIntervalMs?: number; pollMaxMs?: number } = {}) {
  const t = useTranslations("employeeImportForm");
  const fileRef = useRef<HTMLInputElement>(null);
  const [status, setStatus] = useState<"idle" | "parsing" | "uploading" | "processing" | "done" | "error">("idle");
  const [progress, setProgress] = useState({ total: 0, success: 0, failed: 0 });
  // GAP-HR-EMPLOYEES-IMPORT-02: what the status route has actually reported. `confirmed`
  // is true only when EVERY accepted chunk reached "completed"; until then the result is
  // worded as "submitted", never as a green "created".
  const [outcome, setOutcome] = useState({ submitted: 0, created: 0, asyncFailed: 0, polled: false, confirmed: false });
  const [errors, setErrors] = useState<string[]>([]);
  // GAP-HR-EMPLOYEES-IMPORT-06: structured alongside the plain display
  // strings above (which stay exactly as before, so the existing on-screen
  // wording/tests are untouched) so a real CSV can be built from them --
  // the display strings themselves are already fully-formed sentences, not
  // suitable for re-splitting into columns.
  const [errorRows, setErrorRows] = useState<{ lineNo: number; fullName: string; message: string }[]>([]);
  const formError = useFormError("employee row");
  // Polling must stop if the page is left mid-import. The flag is reset on every mount, not just
  // set in the cleanup: React StrictMode (reactStrictMode: true, so `next dev`) runs mount ->
  // cleanup -> mount, and a flag that is only ever set to true would stay true after the second
  // mount and end the poll loop after its first round, leaving the form stuck in "processing".
  const unmounted = useRef(false);
  useEffect(() => {
    unmounted.current = false;
    return () => { unmounted.current = true; };
  }, []);

  function downloadErrorReport() {
    const csvLines = [
      "lineNo,fullName,message",
      ...errorRows.map((r) => [r.lineNo, `"${r.fullName.replace(/"/g, '""')}"`, `"${r.message.replace(/"/g, '""')}"`].join(",")),
    ];
    downloadCsvFile("import-errors.csv", csvLines.join("\n"));
  }

  async function loadCodeMap(path: string): Promise<Map<string, string>> {
    const res = await fetch(path);
    if (!res.ok) return new Map();
    const body = (await res.json()) as { data?: { id: string; code: string }[] } | { id: string; code: string }[];
    const rows = Array.isArray(body) ? body : (body.data ?? []);
    return new Map(rows.map((r) => [r.code, r.id]));
  }

  /** Batch id out of a 202 body ({ id } flat, or { data: { id } }); null when the server did not send one. */
  async function readBatchId(res: Response): Promise<string | null> {
    try {
      const parsed = JSON.parse(await res.text()) as { id?: unknown; data?: { id?: unknown } };
      const id = parsed.id ?? parsed.data?.id;
      return typeof id === "string" && id.length > 0 ? id : null;
    } catch {
      return null;
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    // One import at a time: the button is disabled while busy, but a second submit
    // (Enter key, programmatic) must not start a second run either.
    if (status === "uploading" || status === "processing") return;
    const file = fileRef.current?.files?.[0];
    if (!file) { setStatus("error"); setErrors([t("errSelectFile")]); return; }

    setStatus("parsing");
    setErrors([]);
    setErrorRows([]);
    setOutcome({ submitted: 0, created: 0, asyncFailed: 0, polled: false, confirmed: false });
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
    // GAP-HR-EMPLOYEES-IMPORT-01: a 403 means the caller may not bulk-import at all. It is
    // reported ONCE (not once per row) and stops the run -- retrying the next chunk cannot help.
    let forbidden = false;
    const accepted: AcceptedBatch[] = [];

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
      if (chunk.length === 0 || forbidden) return;
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
        // Accepted and queued for async creation: "submitted", NOT yet "created".
        // The batch id lets the status route confirm the real outcome below.
        success += chunk.length;
        const batchId = await readBatchId(res);
        if (batchId) accepted.push({ batchId, rows: chunk });
        setProgress({ total: rows.length, success, failed: errs.length });
        return;
      }

      if (res.status === 403) {
        forbidden = true;
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
      if (forbidden) break;
      await submitChunk(resolved.slice(i, i + BULK_MAX_PER_REQUEST));
    }

    if (forbidden) {
      // One message for the whole refusal. Row-level validation noise gathered before it is dropped:
      // the import was refused outright, so there is nothing for the user to fix row by row.
      setErrors(success > 0 ? [...errs, t("errForbidden")] : [t("errForbidden")]);
      setErrorRows(success > 0 ? errRows : []);
      setOutcome({ submitted: success, created: 0, asyncFailed: 0, polled: false, confirmed: false });
      setStatus(success > 0 ? "done" : "error");
      return;
    }

    // ---- GAP-HR-EMPLOYEES-IMPORT-02: confirm what actually happened -------------------------------
    // 202 only means queued. Poll each accepted batch's status route until every batch reports
    // "completed" (or the time budget runs out) and report created / failed from THAT, never from
    // the 202s. A server that sent no batch id (older backend) simply skips this and stays "submitted".
    let created = 0;
    let asyncFailed = 0;
    let confirmed = accepted.length > 0;
    if (accepted.length > 0) {
      setStatus("processing");
      setOutcome({ submitted: success, created: 0, asyncFailed: 0, polled: true, confirmed: false });
      const latest = new Map<string, BatchStatus>();
      const unconfirmable = new Set<string>();
      const deadline = Date.now() + pollMaxMs;
      for (;;) {
        await Promise.all(
          accepted
            .filter((b) => latest.get(b.batchId)?.status !== "completed" && !unconfirmable.has(b.batchId))
            .map(async (b) => {
              try {
                const res = await fetch(`/api/proxy/v1/hrms/employees/bulk/status/${encodeURIComponent(b.batchId)}`);
                if (res.status === 404) { unconfirmable.add(b.batchId); return; }
                if (!res.ok) return; // transient: try again next round
                const parsed = parseBatchStatus(JSON.parse(await res.text()));
                if (parsed) latest.set(b.batchId, parsed);
              } catch {
                /* transient: try again next round */
              }
            }),
        );
        created = 0;
        asyncFailed = 0;
        for (const s of latest.values()) { created += s.created; asyncFailed += s.failed; }
        if (unmounted.current) return;
        setOutcome({ submitted: success, created, asyncFailed, polled: true, confirmed: false });
        const allDone = accepted.every((b) => latest.get(b.batchId)?.status === "completed" || unconfirmable.has(b.batchId));
        if (allDone || Date.now() >= deadline) break;
        await sleep(pollIntervalMs);
        if (unmounted.current) return;
      }
      confirmed = accepted.every((b) => latest.get(b.batchId)?.status === "completed");
      // Name each row the server could not create (rowNo is 1-based within the chunk that was posted).
      for (const b of accepted) {
        for (const f of latest.get(b.batchId)?.failedRows ?? []) {
          const row = b.rows[f.rowNo - 1];
          if (!row) continue;
          const reason = t(ROW_FAILURE_KEYS[f.code] ?? "rowFailGeneric");
          errs.push(t("errRowSave", { lineNo: row.lineNo, fullName: row.fullName, message: reason }));
          errRows.push({ lineNo: row.lineNo, fullName: row.fullName, message: reason });
        }
      }
    }

    setProgress({ total: rows.length, success, failed: errs.length });
    setOutcome({ submitted: success, created, asyncFailed, polled: accepted.length > 0, confirmed });
    setErrors(errs);
    setErrorRows(errRows);
    setStatus("done");
  }

  const busy = status === "uploading" || status === "processing";
  const pendingCount = Math.max(0, outcome.submitted - outcome.created - outcome.asyncFailed);

  return (
    <form noValidate onSubmit={handleSubmit}>
      <Field id="import-csv-file" label={t("fileLabel")} required style={{ marginBottom: 12 }}>
        <Input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          aria-describedby="import-csv-hint"
        />
        <p id="import-csv-hint" style={{ fontSize: 12, color: "var(--mut)", margin: 0 }}>
          {t("requiredColumnsHint", { columns: REQUIRED_COLUMNS.join(", ") })}
        </p>
        <p style={{ fontSize: 12, color: "var(--mut)", margin: 0 }}>
          {t("optionalColumnsHint", { columns: OPTIONAL_COLUMNS.join(", ") })}
        </p>
      </Field>
      <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
        <Button type="submit" variant="primary" disabled={busy} style={{ minHeight: 44 }}>
          {status === "uploading"
            ? t("importingProgress", { success: progress.success, total: progress.total })
            : status === "processing"
              ? t("processingProgress", { done: outcome.created + outcome.asyncFailed, submitted: outcome.submitted })
              : t("uploadBtn")}
        </Button>
        {/* Shown at once when the server accepts the rows, and kept while the status route is polled. */}
        {status === "processing" && (
          <span role="status" style={{ fontSize: 13, color: "var(--mut)" }}>
            {t("submittedProcessing", { submitted: outcome.submitted })}
          </span>
        )}
        {status === "done" && !outcome.polled && (
          <span style={{ fontSize: 13, color: progress.failed === 0 ? "var(--good)" : "var(--bad)" }}>
            {t("resultImported", { success: progress.success })}
            {progress.failed > 0 ? t("resultFailedSuffix", { failed: progress.failed }) : ""}
          </span>
        )}
        {status === "done" && outcome.polled && outcome.confirmed && (
          <span style={{ fontSize: 13, color: errors.length === 0 ? "var(--good)" : "var(--bad)" }}>
            {t("resultCreated", { created: outcome.created })}
            {progress.failed > 0 ? t("resultFailedSuffix", { failed: progress.failed }) : ""}
          </span>
        )}
        {/* Not confirmed (timed out, or the status could not be read): never a green check. */}
        {status === "done" && outcome.polled && !outcome.confirmed && (
          <span role="status" style={{ fontSize: 13, color: "var(--mut)" }}>
            {t("resultUnconfirmed", { submitted: outcome.submitted, created: outcome.created, pending: pendingCount })}
          </span>
        )}
      </div>
      {errors.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div role="alert" style={{ padding: "10px 14px", borderRadius: 8, background: "var(--badbg)", border: "1px solid var(--badbd)", fontSize: 12.5, color: "var(--bad)", maxHeight: 200, overflow: "auto" }}>
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
