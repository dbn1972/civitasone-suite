/**
 * GL heads / journal state shared by the assets pages (AUC projects, leases, settings).
 * Message KEYS only (namespace `assetsGl` in messages/en.json + hi.json); the pages translate them.
 */
export type GlErrorKey = "glHeadsNotConfigured" | "glHeadInvalid" | "financeUnavailable" | "journalNotFailed";

const ERROR_KEYS: Record<string, GlErrorKey> = {
  ASSET_GL_NOT_CONFIGURED: "glHeadsNotConfigured",
  GL_HEAD_INVALID: "glHeadInvalid",
  FINANCE_UNAVAILABLE: "financeUnavailable",
  JOURNAL_NOT_FAILED: "journalNotFailed",
};

/** The translation key for a GL-heads error code returned by asset-service, or null for any other code. */
export function glErrorKey(code: string | null): GlErrorKey | null {
  return code && Object.prototype.hasOwnProperty.call(ERROR_KEYS, code) ? (ERROR_KEYS[code] as GlErrorKey) : null;
}

export type JournalState = "none" | "awaiting_accounts" | "pending" | "posted" | "failed";
export type JournalKey = "journalNone" | "journalAwaiting" | "journalPending" | "journalPosted" | "journalFailed";

/**
 * Finance-side state of a journal (capitalisation, lease, acquisition, maintenance); unknown values read as "none".
 * "awaiting_accounts": the record is saved but its journal is deferred until the GL accounts are configured.
 */
export function journalState(value: unknown): JournalState {
  return value === "awaiting_accounts" || value === "pending" || value === "posted" || value === "failed" ? value : "none";
}

export function journalKey(state: JournalState): JournalKey {
  return state === "awaiting_accounts" ? "journalAwaiting" : state === "pending" ? "journalPending" : state === "posted" ? "journalPosted" : state === "failed" ? "journalFailed" : "journalNone";
}

/** Pill tone for a journal state. */
export function journalTone(state: JournalState): "good" | "bad" | "warn" {
  return state === "posted" ? "good" : state === "failed" ? "bad" : "warn";
}

export type RejectionKey = "rejectPeriodClosed" | "rejectNotLeaf" | "rejectUnknownAccount" | "rejectGeneric";

/**
 * How a finance refusal is explained. asset-service stores the refusal as "CODE: reason" (gl_post_error). A closed
 * period is NEVER fixed by silently re-dating the journal: the note says it needs a date in an open period and that it is
 * re-sent once the period is open. Returns null when there is no error text.
 */
export function rejectionNote(error: unknown): { key: RejectionKey; reason: string } | null {
  if (typeof error !== "string" || error.trim() === "") return null;
  const m = /^([A-Z][A-Z_]+):\s*(.*)$/s.exec(error.trim());
  const code = m?.[1] ?? "";
  const reason = (m?.[2] ?? error).trim();
  if (code.startsWith("PERIOD_")) return { key: "rejectPeriodClosed", reason };
  if (code === "NOT_LEAF_ACCOUNT") return { key: "rejectNotLeaf", reason };
  if (code === "UNKNOWN_ACCOUNT_CODE") return { key: "rejectUnknownAccount", reason };
  return { key: "rejectGeneric", reason };
}
