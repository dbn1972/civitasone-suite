/**
 * GL heads / journal state shared by the assets pages (AUC projects, leases, settings).
 * Message KEYS only (namespace `assetsGl` in messages/en.json + hi.json); the pages translate them.
 */
export type GlErrorKey = "glHeadsNotConfigured" | "glHeadInvalid" | "financeUnavailable" | "journalNotFailed";

const ERROR_KEYS: Record<string, GlErrorKey> = {
  GL_HEADS_NOT_CONFIGURED: "glHeadsNotConfigured",
  GL_HEAD_INVALID: "glHeadInvalid",
  FINANCE_UNAVAILABLE: "financeUnavailable",
  JOURNAL_NOT_FAILED: "journalNotFailed",
};

/** The translation key for a GL-heads error code returned by asset-service, or null for any other code. */
export function glErrorKey(code: string | null): GlErrorKey | null {
  return code && Object.prototype.hasOwnProperty.call(ERROR_KEYS, code) ? (ERROR_KEYS[code] as GlErrorKey) : null;
}

export type JournalState = "none" | "pending" | "posted" | "failed";
export type JournalKey = "journalNone" | "journalPending" | "journalPosted" | "journalFailed";

/** Finance-side state of the capitalisation / lease-recognition journal; unknown values read as "none". */
export function journalState(value: unknown): JournalState {
  return value === "pending" || value === "posted" || value === "failed" ? value : "none";
}

export function journalKey(state: JournalState): JournalKey {
  return state === "pending" ? "journalPending" : state === "posted" ? "journalPosted" : state === "failed" ? "journalFailed" : "journalNone";
}
