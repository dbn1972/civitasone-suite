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
