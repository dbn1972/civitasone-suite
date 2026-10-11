/**
 * Workforce Core — configuration flags (SmartTransfer OS, ST-M01-07).
 *
 * `WORKFORCE_CORE_LEDGER_ENABLED` is the "live behind a flag" switch required by
 * M01 exit criterion 2 (KIRO-BUILD-PROMPT.md §3). ST-M01-07 adds the posting
 * ledger SCHEMA, read models and this flag only. The flag defaults to OFF; later
 * PRs read it to decide whether the single `applyPosting` write path
 * (ST-M01-09) persists into workforce_core.posting_ledger. Keeping the schema in
 * place while the writer stays dark lets the ledger be enabled per deployment
 * without a further migration.
 *
 * The value is parsed strictly (no z.coerce.boolean — house rule 8): only the
 * exact string "true" (case-insensitive, trimmed) enables it; anything else,
 * including unset, leaves it off (fail-safe default).
 */

/** True only when WORKFORCE_CORE_LEDGER_ENABLED is explicitly "true". */
export function isPostingLedgerEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.WORKFORCE_CORE_LEDGER_ENABLED;
  if (typeof raw !== "string") return false;
  return raw.trim().toLowerCase() === "true";
}

/** The env var name, exported so ST-M01-09 and tests reference one constant. */
export const POSTING_LEDGER_FLAG = "WORKFORCE_CORE_LEDGER_ENABLED" as const;

/**
 * `HRMS_POSTING_EVENTS_ENABLED` gates whether the single applyPosting write path
 * ALSO publishes the standalone `hrms.posting.applied` / `hrms.posting.changed`
 * domain events (ST-M01-09). It defaults to OFF because those topics' declared
 * consumers are not wired on main yet — payroll (OPEN D-ST-13), estab/
 * notification, and smarttransfer-service (reconciliation, PR #1979, unmerged).
 * Emitting a topic no service consumes would be a publish-into-void orphan that
 * trips the cross-service-events ratchet (D-101: the ratchet only moves down,
 * and a new allow-list entry needs an APPROVED decision — D-ST-13/09 are
 * PROPOSED). The posting FACT is always recorded on `audit.event.record` in the
 * same transaction regardless of this flag, so nothing is lost when it is off;
 * the standalone events light up (no further migration) once a consumer lands.
 * Same precedent as ST-M01-03 / ST-M01-12. Parsed strictly (no
 * z.coerce.boolean): only the exact string "true" enables it.
 */
export function isPostingEventsEnabled(
  env: NodeJS.ProcessEnv = process.env,
): boolean {
  const raw = env.HRMS_POSTING_EVENTS_ENABLED;
  if (typeof raw !== "string") return false;
  return raw.trim().toLowerCase() === "true";
}

/** The posting-events env var name, exported for ST-M01-09 and tests. */
export const POSTING_EVENTS_FLAG = "HRMS_POSTING_EVENTS_ENABLED" as const;
