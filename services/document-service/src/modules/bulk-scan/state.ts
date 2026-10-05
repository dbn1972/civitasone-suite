/**
 * Per-file state machine for the bulk-scan pipeline - the ONE place the allowed transitions live.
 *
 *   pending_upload -> uploaded -> scanning -> queued -> ocr_running -> extracted
 *        -> needs_review | ready_to_file -> filed
 *   plus: scan_pending (malware scanner unavailable, fail-closed, retried), failed(reason),
 *         quarantined (infected), skipped_duplicate, skipped (operator), cancelled (batch cancel).
 *
 * `pending_upload` precedes the brief's `uploaded`: the row is registered when the presigned URL is
 * issued (so limits and server-chosen storage keys are enforced server-side) and becomes `uploaded`
 * only once the object is verified by the `files/complete` command.
 *
 * The transition table is mirrored by the CHECK constraint in migration 0005; a test keeps them in sync.
 */
export const FILE_STATES = [
  "pending_upload", "uploaded", "scanning", "scan_pending", "queued", "ocr_running",
  "extracted", "needs_review", "ready_to_file", "filed", "failed", "quarantined",
  "skipped_duplicate", "skipped", "cancelled",
] as const;
export type FileState = (typeof FILE_STATES)[number];

export const TRANSITIONS: Readonly<Record<FileState, readonly FileState[]>> = {
  pending_upload:    ["uploaded", "failed", "skipped", "cancelled"],
  uploaded:          ["scanning", "failed", "skipped_duplicate", "cancelled"],
  scanning:          ["queued", "quarantined", "scan_pending", "failed", "cancelled"],
  scan_pending:      ["scanning", "failed", "skipped", "cancelled"],
  queued:            ["ocr_running", "failed", "skipped", "cancelled"],
  ocr_running:       ["extracted", "queued", "failed", "cancelled"],
  extracted:         ["needs_review", "ready_to_file", "failed"],
  needs_review:      ["ready_to_file", "failed", "skipped", "cancelled"],
  ready_to_file:     ["filed", "needs_review", "failed", "cancelled"],
  // retry: a failed file goes back to the stage that failed (scan_pending if never scanned clean, else queued)
  failed:            ["scan_pending", "queued", "skipped"],
  filed:             [],
  quarantined:       [],
  skipped_duplicate: [],
  skipped:           [],
  cancelled:         [],
};

/** No further transitions possible. */
export const TERMINAL_STATES: readonly FileState[] = FILE_STATES.filter((s) => TRANSITIONS[s].length === 0);

/**
 * States in which the PIPELINE has nothing more to do for the file. needs_review / ready_to_file wait
 * for humans (review + filing), failed waits for retry/skip; none of them keep a batch "processing".
 */
export const PIPELINE_SETTLED_STATES: readonly FileState[] = [
  "needs_review", "ready_to_file", "filed", "failed", "quarantined", "skipped_duplicate", "skipped", "cancelled",
];

/** In-flight states leased to a worker (swept when the lease expires). */
export const LEASED_STATES: readonly FileState[] = ["scanning", "ocr_running"];

/** Hash-canonical flag is released when a file leaves the live set. */
export const CANONICAL_RELEASING_STATES: readonly FileState[] = ["failed", "quarantined", "skipped", "cancelled", "skipped_duplicate"];

export function isFileState(s: string): s is FileState {
  return (FILE_STATES as readonly string[]).includes(s);
}

export function canTransition(from: FileState, to: FileState): boolean {
  return TRANSITIONS[from].includes(to);
}

export class IllegalTransitionError extends Error {
  constructor(public readonly from: FileState, public readonly to: FileState) {
    super(`illegal bulk-scan file transition ${from} -> ${to}`);
    this.name = "IllegalTransitionError";
  }
}

/** Throws IllegalTransitionError unless EVERY `from` may move to `to`. */
export function assertTransition(from: readonly FileState[], to: FileState): void {
  if (from.length === 0) throw new Error("assertTransition: `from` must list at least one state");
  for (const f of from) if (!canTransition(f, to)) throw new IllegalTransitionError(f, to);
}

/** Failure reasons that can never succeed on retry (the content itself is rejected / missing). */
export const PERMANENT_FAILURE_REASONS: readonly string[] = [
  "EMPTY_FILE", "EXECUTABLE_CONTENT", "SVG_NOT_ALLOWED", "UNSUPPORTED_FILE_TYPE", "ENCRYPTED_PDF", "MIME_MISMATCH",
  "FILE_TOO_LARGE", "SIZE_MISMATCH", "UPLOAD_MISSING", "CORRUPT", "TOO_MANY_PAGES", "UNSUPPORTED_TYPE", "UPLOAD_EXPIRED",
];

/** States an operator may skip a file from. */
export const SKIPPABLE_STATES: readonly FileState[] = ["pending_upload", "scan_pending", "queued", "needs_review", "failed"];
