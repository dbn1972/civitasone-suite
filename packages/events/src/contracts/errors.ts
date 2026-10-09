/**
 * FF-02 WP1 — PII-safe contract violation formatter (design section 5, F4).
 *
 * A contract violation is logged to the SIEM (180-day retention) and recorded
 * in `_inbox.command_results`. Zod's own `issue.message` ECHOES the received
 * value — e.g. for `z.enum(["paid","open"])` given an Aadhaar-shaped string it
 * returns `Invalid enum value. Expected 'paid' | 'open', received
 * 'AADHAAR-123456789012'` (finding F4, proved on zod 3.23.8). Writing that to a
 * log or a DLQ attribute would leak personal data (DPDP s.8(5)).
 *
 * So a violation record carries the field PATH and the zod issue CODE only.
 * Never the received value, never zod's rendered message, never the payload.
 */
import type { SafeParseError } from "zod";

/** The reason codes FF-02 records on a contract/tenant failure (design 2.4). */
export type ViolationCode =
  | "CONTRACT_INVALID"
  | "CONTRACT_UNKNOWN_MAJOR"
  | "TENANT_MISMATCH"
  | "NO_HANDLER";

/** One issue, reduced to a path and a machine code — no value, no message. */
export interface ViolationIssue {
  /** Dotted path to the offending field, e.g. "lines.0.amountMinor". */
  path: string;
  /** The zod issue code, e.g. "invalid_type", "invalid_enum_value". */
  code: string;
}

/** A PII-safe violation record, suitable for a log line, DLQ attr or result row. */
export interface ViolationRecord {
  code: ViolationCode;
  topic: string;
  /** Field-level issues; empty for non-schema violations (e.g. TENANT_MISMATCH). */
  issues: ViolationIssue[];
}

/**
 * Build a PII-safe record from a failed zod parse. Only the path and the zod
 * issue code survive; the received value and zod's message are discarded.
 */
export function formatContractViolation(
  topic: string,
  parsed: SafeParseError<unknown>,
  code: ViolationCode = "CONTRACT_INVALID",
): ViolationRecord {
  return {
    code,
    topic,
    issues: parsed.error.issues.map((issue) => ({
      path: issue.path.map((p) => String(p)).join("."),
      code: issue.code,
    })),
  };
}

/**
 * Error carried through the queue so the three drivers' existing NonRetryable
 * paths DLQ the message and record a `rejected` outcome (design C5). It extends
 * Error but its `message` is deliberately value-free: it names the topic and
 * the issue PATHS only.
 */
export class ContractViolationError extends Error {
  readonly record: ViolationRecord;

  constructor(record: ViolationRecord) {
    const paths = record.issues.map((i) => i.path).filter(Boolean).join(", ");
    super(
      paths
        ? `contract violation on '${record.topic}' (${record.code}) at: ${paths}`
        : `contract violation on '${record.topic}' (${record.code})`,
    );
    this.name = "ContractViolationError";
    this.record = record;
  }
}

/** True if a string contains no value-shaped payload leakage from a record. */
export function violationRecordIsPiiSafe(record: ViolationRecord): boolean {
  // A record is safe by construction: it holds only enum-like codes and paths.
  // This predicate exists for the DoD test to assert against the SERIALISED form.
  const serialised = JSON.stringify(record);
  // zod's leaky phrasing always contains the word "received"; a safe record never does.
  return !serialised.includes("received") && !/\bInvalid enum value\b/.test(serialised);
}
