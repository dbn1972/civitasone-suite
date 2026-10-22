/**
 * GAP-HR-EMPLOYEES-IMPORT-02: stable failure codes for a bulk-import row, and
 * the mapping from "what went wrong in the hrms.employee.create consumer" to one.
 *
 * Only a CODE is ever stored or returned (never the error text): a drizzle/driver
 * failure message embeds the failing SQL and its parameters -- names, mobile
 * numbers -- which must not be copied into a status table or sent to a browser.
 */
import { CommandRefusal, refusalCodeOf, type CommandOutcome } from "../../shared/outbox.js";

export const IMPORT_FAILURE = {
  /** An employee with this number already exists (unique (tenant_id, employee_no)). */
  EMPLOYEE_NO_EXISTS: "EMPLOYEE_NO_EXISTS",
  /** A referenced department / designation / manager / pay structure is gone. */
  INVALID_REFERENCE: "INVALID_REFERENCE",
  /** A value broke a column constraint or type. */
  INVALID_VALUE: "INVALID_VALUE",
  /** The row was recorded but could not be put on the queue (route-side). */
  NOT_QUEUED: "NOT_QUEUED",
  /** Anything else: retries were exhausted or the failure is not one of the above. */
  CREATE_FAILED: "CREATE_FAILED",
} as const;

export type ImportFailureCode = (typeof IMPORT_FAILURE)[keyof typeof IMPORT_FAILURE];

const KNOWN_CODES = new Set<string>(Object.values(IMPORT_FAILURE));

/** SQLSTATE -> failure code, for the constraint violations that can never succeed on a retry. */
const PG_STATE_TO_CODE: Record<string, ImportFailureCode> = {
  "23505": IMPORT_FAILURE.EMPLOYEE_NO_EXISTS, // unique_violation
  "23503": IMPORT_FAILURE.INVALID_REFERENCE, // foreign_key_violation
  "23514": IMPORT_FAILURE.INVALID_VALUE, // check_violation
  "23502": IMPORT_FAILURE.INVALID_VALUE, // not_null_violation
};

/** The SQLSTATE of a driver error, whether it is the error itself or wrapped as `cause` (drizzle wraps). */
export function sqlStateOf(err: unknown): string | undefined {
  let cur: unknown = err;
  for (let depth = 0; depth < 4 && cur && typeof cur === "object"; depth++) {
    const code = (cur as { code?: unknown }).code;
    if (typeof code === "string" && /^[0-9A-Z]{5}$/.test(code)) return code;
    cur = (cur as { cause?: unknown }).cause;
  }
  return undefined;
}

/**
 * Turn a deterministic database refusal into a CommandRefusal (non-retryable, so the queue
 * dead-letters it at once and reports a 'rejected' outcome with this code) and leave
 * everything else -- a dropped connection, a deadlock -- untouched so it keeps being retried.
 */
export function classifyCreateFailure(err: unknown): unknown {
  const state = sqlStateOf(err);
  // SQLSTATE class 22 is "data exception" (value too long, bad date / number / text representation, ...):
  // the row's own data is wrong, so a retry can never help.
  const code = state ? (PG_STATE_TO_CODE[state] ?? (state.startsWith("22") ? IMPORT_FAILURE.INVALID_VALUE : undefined)) : undefined;
  if (!code) return err;
  return new CommandRefusal(code, {}, `${code}: employee could not be created (sqlstate ${state})`, err);
}

/** The code to store for a failed outcome delivered by the queue's onOutcome hook. */
export function failureCodeFromOutcome(outcome: Pick<CommandOutcome, "status" | "reason">): ImportFailureCode {
  if (outcome.status === "rejected") {
    const parsed = refusalCodeOf({ message: outcome.reason ?? "" });
    if (KNOWN_CODES.has(parsed)) return parsed as ImportFailureCode;
  }
  return IMPORT_FAILURE.CREATE_FAILED;
}
