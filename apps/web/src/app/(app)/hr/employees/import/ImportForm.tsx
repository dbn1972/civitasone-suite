"use client";

import { useEffect, useId, useRef, useState } from "react";
import { useTranslations } from "next-intl";
import { useFormError } from "@/lib/useFormError";
import { rupeesToMinorString } from "@/lib/money";
import { formatMoney } from "@/lib/formatters";
import { Button, DataTable, Field, Input } from "../../../../_components/ds";
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

/** A PreviewRow as the review DataTable shows it: an `id` for the row key, and "—" for a blank cell. */
type PreviewTableRow = PreviewRow & { id: string };

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

type Phase = "idle" | "parsing" | "preview" | "uploading" | "processing" | "done" | "error";

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

// Stable failure codes from the status route, each mapped to a translated reason (never the server text).
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

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** How often, and for how long, an accepted import is polled for its real outcome. */
const DEFAULT_POLL_INTERVAL_MS = 2000;
const DEFAULT_POLL_MAX_MS = 60_000;
/**
 * The batch record is written by a queue consumer AFTER the 202 (the route only publishes), so the status route can
 * answer 404 for a batch it simply has not recorded yet. For this long after the last chunk was accepted a 404 means
 * "not yet", and polling continues; after it, a 404 means this batch cannot be confirmed.
 */
const DEFAULT_NOT_RECORDED_GRACE_MS = 10_000;

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
export function ImportForm({
  pollIntervalMs = DEFAULT_POLL_INTERVAL_MS,
  pollMaxMs = DEFAULT_POLL_MAX_MS,
  notRecordedGraceMs = DEFAULT_NOT_RECORDED_GRACE_MS,
}: { pollIntervalMs?: number; pollMaxMs?: number; notRecordedGraceMs?: number } = {}) {
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
  // GAP-HR-EMPLOYEES-IMPORT-02: what the status route has actually reported. `confirmed`
  // is true only when EVERY accepted chunk reached "completed"; until then the result is
  // worded as "submitted", never as a green "created".
  const [outcome, setOutcome] = useState({ submitted: 0, created: 0, asyncFailed: 0, polled: false, confirmed: false });
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
    setOutcome({ submitted: 0, created: 0, asyncFailed: 0, polled: false, confirmed: false });
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

  async function handleReview(e: React.FormEvent) {
    e.preventDefault();
    // One import at a time: the button is disabled while busy, but a second submit
    // (Enter key, programmatic) must not start a second run either.
    if (status === "uploading" || status === "processing") return;
    const file = fileRef.current?.files?.[0];
    if (!file) { setStatus("error"); setErrors([t("errSelectFile")]); return; }

    setStatus("parsing");
    setErrors([]);
    setErrorRows([]);
    setReview(null);
    setOutcome({ submitted: 0, created: 0, asyncFailed: 0, polled: false, confirmed: false });
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
    // One import at a time (see handleReview).
    if (status === "uploading" || status === "processing") return;
    const { valid: resolved, fileRows } = review;
    // Rows already rejected in the review step carry through to the final tally.
    const errs: string[] = [...review.errs];
    const errRows: ErrorRow[] = [...review.errRows];
    let success = 0;
    // GAP-HR-EMPLOYEES-IMPORT-01: a 403 means the caller may not bulk-import at all. It is
    // reported ONCE (not once per row) and stops the run -- retrying the next chunk cannot help.
    let forbidden = false;
    const accepted: AcceptedBatch[] = [];

    setStatus("uploading");
    setOutcome({ submitted: 0, created: 0, asyncFailed: 0, polled: false, confirmed: false });
    setProgress({ total: fileRows, success, failed: errs.length });

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
        setProgress({ total: fileRows, success, failed: errs.length });
        return;
      }

      if (res.ok || res.status === 202) {
        // Accepted and queued for async creation: "submitted", NOT yet "created".
        // The batch id lets the status route confirm the real outcome below.
        success += chunk.length;
        const batchId = await readBatchId(res);
        if (batchId) accepted.push({ batchId, rows: chunk });
        setProgress({ total: fileRows, success, failed: errs.length });
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
      if (forbidden) break;
      await submitChunk(resolved.slice(i, i + BULK_MAX_PER_REQUEST));
    }

    if (forbidden) {
      // One message for the whole refusal. Row-level validation noise gathered before it is dropped:
      // the import was refused outright, so there is nothing for the user to fix row by row.
      setErrors(success > 0 ? [...errs, t("errForbidden")] : [t("errForbidden")]);
      setErrorRows(success > 0 ? errRows : []);
      setOutcome({ submitted: success, created: 0, asyncFailed: 0, polled: false, confirmed: false });
      setReview(null);
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
      const acceptedAt = Date.now();
      const deadline = acceptedAt + pollMaxMs;
      for (;;) {
        await Promise.all(
          accepted
            .filter((b) => latest.get(b.batchId)?.status !== "completed" && !unconfirmable.has(b.batchId))
            .map(async (b) => {
              try {
                const res = await fetch(`/api/proxy/v1/hrms/employees/bulk/status/${encodeURIComponent(b.batchId)}`);
                if (res.status === 404) {
                  // Not recorded YET (see DEFAULT_NOT_RECORDED_GRACE_MS) -> keep polling; past the grace -> unconfirmable.
                  if (Date.now() - acceptedAt >= notRecordedGraceMs) unconfirmable.add(b.batchId);
                  return;
                }
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

    setProgress({ total: fileRows, success, failed: errs.length });
    setOutcome({ submitted: success, created, asyncFailed, polled: accepted.length > 0, confirmed });
    setErrors(errs);
    setErrorRows(errRows);
    setReview(null);
    setStatus("done");
  }

  const reviewing = status === "preview" && review !== null;
  const validCount = review?.valid.length ?? 0;
  const skippedCount = review ? review.fileRows - validCount : 0;
  const busy = status === "uploading" || status === "processing";
  const pendingCount = Math.max(0, outcome.submitted - outcome.created - outcome.asyncFailed);
  // The review table is the shared DataTable (a11y, mobile layout, empty state), not a bare table. Its headers
  // other than Row / Check are the CSV's own column names, kept literal on purpose so they match the file.
  const previewCaptionId = useId();
  const previewColumns: { key: keyof PreviewTableRow & string; label: string; render?: (row: PreviewTableRow) => React.ReactNode }[] = [
    { key: "lineNo", label: t("previewColRow") },
    { key: "employeeNo", label: "employeeNo" },
    { key: "fullName", label: "fullName" },
    { key: "departmentCode", label: "departmentCode" },
    { key: "designationCode", label: "designationCode" },
    { key: "dateOfJoining", label: "dateOfJoining" },
    { key: "basicPay", label: "basicPay" },
    {
      key: "ok",
      label: t("previewColCheck"),
      render: (r) => <span style={{ color: r.ok ? "var(--good)" : "var(--bad)" }}>{r.ok ? t("previewRowReady") : t("previewRowSkipped")}</span>,
    },
  ];
  const previewRows: PreviewTableRow[] = (review?.sample ?? []).map((r) => ({
    id: String(r.lineNo), lineNo: r.lineNo,
    employeeNo: r.employeeNo || "—", fullName: r.fullName || "—", departmentCode: r.departmentCode || "—",
    designationCode: r.designationCode || "—", dateOfJoining: r.dateOfJoining || "—", basicPay: r.basicPay || "—", ok: r.ok,
  }));
  // Colour of the live-region result: green only when nothing failed; muted while we are still
  // waiting on (or could not get) the server's word; red when any row failed.
  const resultColor =
    status === "processing" || (status === "done" && outcome.polled && !outcome.confirmed)
      ? "var(--mut)"
      : status === "done"
        ? (outcome.polled ? errors.length === 0 : progress.failed === 0) ? "var(--good)" : "var(--bad)"
        : "var(--ink2)";

  return (
    <form noValidate onSubmit={handleReview}>
      <Field id="import-csv-file" label={t("fileLabel")} required style={{ marginBottom: 12 }}>
        <Input
          ref={fileRef}
          type="file"
          accept=".csv,text/csv"
          aria-describedby="import-csv-hint"
          disabled={busy}
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
        <Button type="submit" variant="primary" disabled={status === "parsing" || busy} style={{ minHeight: 44 }}>
          {status === "parsing" ? t("reviewingBtn") : t("reviewBtn")}
        </Button>
        {/* Polite live region, mounted from the start so a screen reader
            announces the review summary, the "submitted / waiting" progress and
            the final result as each fills in. One region, so exactly one status
            is ever announced. GAP-HR-EMPLOYEES-IMPORT-02: "created" is worded
            only from the status route's own confirmation. */}
        <span
          role="status"
          aria-live="polite"
          style={{ fontSize: 13, color: resultColor }}
        >
          {reviewing && review
            ? t("previewSummary", { total: review.fileRows, valid: validCount, invalid: skippedCount })
            : status === "processing"
              ? t("submittedProcessing", { submitted: outcome.submitted })
              : status === "done" && !outcome.polled
                ? <>
                    {t("resultImported", { success: progress.success })}
                    {progress.failed > 0 ? t("resultFailedSuffix", { failed: progress.failed }) : ""}
                  </>
                : status === "done" && outcome.confirmed
                  ? <>
                      {t("resultCreated", { created: outcome.created })}
                      {progress.failed > 0 ? t("resultFailedSuffix", { failed: progress.failed }) : ""}
                    </>
                  : /* Not confirmed (timed out, or the status could not be read): never a green check. */
                    status === "done"
                      ? t("resultUnconfirmed", { submitted: outcome.submitted, created: outcome.created, pending: pendingCount })
                      : null}
        </span>
      </div>

      {/* GAP-HR-EMPLOYEES-IMPORT-03: nothing below this point has been sent to
          the server. The explicit confirm button is the only thing that posts. */}
      {(reviewing || busy) && review && (
        <div style={{ marginTop: 16 }}>
          {/* Only true before the confirm click; once rows are on the wire it would be wrong. */}
          {reviewing && <p style={{ fontSize: 12.5, color: "var(--mut)", margin: "0 0 8px" }}>{t("previewNote")}</p>}
          <div role="group" aria-labelledby={previewCaptionId} style={{ marginBottom: 8 }}>
            <p id={previewCaptionId} style={{ fontSize: 12, color: "var(--mut)", margin: "0 0 4px" }}>
              {t("previewCaption", { shown: review.sample.length, total: review.fileRows })}
            </p>
            <DataTable<PreviewTableRow> columns={previewColumns} rows={previewRows} />
          </div>
          {validCount === 0 && (
            <p role="alert" style={{ fontSize: 13, color: "var(--bad)", margin: "0 0 8px" }}>{t("previewNothingToImport")}</p>
          )}
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <Button
              type="button"
              variant="primary"
              onClick={() => void handleConfirm()}
              disabled={busy || validCount === 0}
              style={{ minHeight: 44 }}
            >
              {status === "uploading"
                ? t("importingProgress", { success: progress.success, total: progress.total })
                : status === "processing"
                  ? t("processingProgress", { done: outcome.created + outcome.asyncFailed, submitted: outcome.submitted })
                  : t("confirmBtn", { count: validCount })}
            </Button>
            {!busy && (
              <Button type="button" variant="ghost" onClick={() => { if (fileRef.current) fileRef.current.value = ""; resetForNewFile(); }} style={{ minHeight: 44 }}>
                {t("cancelReviewBtn")}
              </Button>
            )}
          </div>
        </div>
      )}

      {errors.length > 0 && (
        <div style={{ marginTop: 12 }}>
          <div role={status === "error" || status === "done" ? "alert" : undefined} style={{ padding: "10px 14px", borderRadius: 8, background: "var(--badbg)", border: "1px solid var(--badbd)", fontSize: 12.5, color: "var(--bad)", maxHeight: 200, overflow: "auto" }}>
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
