/**
 * Stable, user-safe failure reasons for the bulk Form 16 job.
 *
 * The bulk consumer records, per failed employee, WHICH STAGE of the pipeline
 * failed (a closed code), never a classification derived from exception text.
 * The raw exception message can carry S3 keys, SQL fragments, file paths or
 * Chromium internals, so it is kept in the job row and the service log for
 * operators only: GET bulk-status projects the stored entries through
 * `publicFailureDetails`, which is an allow-list ({ employeeNo, reasonCode })
 * and cannot leak the raw text however the stored entry is shaped.
 */

export const FORM16_FAILURE_CODES = [
  /** Salary / tax data for the employee could not be built (HRMS or tax configuration unavailable). */
  "DATA_UNAVAILABLE",
  /** The PDF renderer failed or is not installed on the worker. */
  "RENDERER_UNAVAILABLE",
  /** Digital signing of the rendered PDF failed. */
  "SIGNING_FAILED",
  /** Uploading the finished PDF to object storage failed. */
  "STORAGE_ERROR",
  /** Anything else, including entries written before reason codes existed. */
  "UNKNOWN",
] as const;

export type Form16FailureCode = (typeof FORM16_FAILURE_CODES)[number];

export function isForm16FailureCode(value: unknown): value is Form16FailureCode {
  return typeof value === "string" && (FORM16_FAILURE_CODES as readonly string[]).includes(value);
}

/** One failed employee as stored in form16_bulk_jobs.error_details. `error` is operator-only. */
export type Form16FailureRecord = {
  employeeId: string;
  employeeNo: string;
  error: string;
  reasonCode: Form16FailureCode;
};

/** One failed employee as returned by GET bulk-status. `employeeNo` is "" when the stored entry has none. */
export type Form16PublicFailure = {
  employeeNo: string;
  reasonCode: Form16FailureCode;
};

/** The most failure rows bulk-status returns. A whole-tenant run can fail for thousands of employees. */
export const FORM16_FAILURE_LIST_CAP = 100;

/** The employeeNo the consumer writes for a run-level (non-employee) failure. */
export const FORM16_RUN_LEVEL_EMPLOYEE_NO = "N/A";

export type Form16PublicFailureDetails = {
  /** At most FORM16_FAILURE_LIST_CAP rows, in recorded order. */
  entries: Form16PublicFailure[];
  /** How many failures were recorded in all (>= entries.length). */
  total: number;
};

/**
 * Allow-list projection of the stored error_details jsonb. Returns null when there is
 * nothing to show (no column value, not an array, or no usable entry). An entry that
 * predates reason codes (it has only `error`) maps to UNKNOWN: its raw text is dropped.
 */
export function publicFailureDetails(stored: unknown): Form16PublicFailureDetails | null {
  if (!Array.isArray(stored)) return null;
  const all: Form16PublicFailure[] = [];
  for (const item of stored) {
    if (item === null || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const employeeNo = typeof rec.employeeNo === "string" ? rec.employeeNo.trim() : "";
    all.push({
      employeeNo: employeeNo.slice(0, 64),
      reasonCode: isForm16FailureCode(rec.reasonCode) ? rec.reasonCode : "UNKNOWN",
    });
  }
  if (all.length === 0) return null;
  return { entries: all.slice(0, FORM16_FAILURE_LIST_CAP), total: all.length };
}
