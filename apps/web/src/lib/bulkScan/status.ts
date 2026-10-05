/**
 * Pure status helpers for Bulk scan: pill tone + icon (never colour alone), human-readable failure reasons,
 * retry/skip eligibility (mirrors document-service state.ts) and polling/backoff + progress math.
 */
import type { BatchFileView, BatchProgress } from "./types";

export type Tone = "good" | "warn" | "bad" | "info" | "mut";

export interface StateMeta {
  tone: Tone;
  /** Decorative glyph; the text label always accompanies it so status is never conveyed by colour alone. */
  icon: string;
  /** i18n key under bulkScan.state */
  key: string;
}

const META: Record<string, Omit<StateMeta, "key">> = {
  pending_upload: { tone: "mut", icon: "…" },
  uploaded: { tone: "info", icon: "⏳" },
  scanning: { tone: "info", icon: "⏳" },
  scan_pending: { tone: "warn", icon: "⚠" },
  queued: { tone: "info", icon: "⏳" },
  ocr_running: { tone: "info", icon: "⏳" },
  extracted: { tone: "info", icon: "⏳" },
  needs_review: { tone: "warn", icon: "👁" },
  ready_to_file: { tone: "good", icon: "✓" },
  filed: { tone: "good", icon: "✓" },
  failed: { tone: "bad", icon: "✕" },
  quarantined: { tone: "bad", icon: "⛔" },
  skipped_duplicate: { tone: "mut", icon: "⧉" },
  skipped: { tone: "mut", icon: "⤼" },
  cancelled: { tone: "mut", icon: "∅" },
};

export const KNOWN_FILE_STATES = Object.keys(META);

export function fileStateMeta(state: string): StateMeta {
  const m = META[state];
  return m ? { ...m, key: `state.${state}` } : { tone: "mut", icon: "?", key: "state.unknown" };
}

export const BATCH_STATUSES_META: Record<string, Tone> = { open: "info", processing: "info", completed: "good", cancelled: "mut" };
export function batchStatusTone(status: string): Tone {
  return BATCH_STATUSES_META[status] ?? "mut";
}
export const BATCH_STATUS_ICON: Record<string, string> = { open: "○", processing: "⏳", completed: "✓", cancelled: "∅" };

export const LINK_STATE_META: Record<string, { tone: Tone; icon: string }> = {
  awaiting_approval: { tone: "warn", icon: "⏳" },
  linked: { tone: "good", icon: "🔗" },
  flagged_mismatch: { tone: "bad", icon: "⚠" },
  rejected: { tone: "bad", icon: "✕" },
  unlink_requested: { tone: "warn", icon: "⏳" },
  unlinked: { tone: "mut", icon: "∅" },
};
export function linkStateMeta(state: string): { tone: Tone; icon: string; key: string } {
  const m = LINK_STATE_META[state];
  return m ? { ...m, key: `linkState.${state}` } : { tone: "mut", icon: "?", key: "linkState.unknown" };
}

// ── failure reasons ─────────────────────────────────────────────

/** Every reason code the server can attach to a file or an upload rejection (document-service magic.ts/limits.ts/state.ts/pipeline). */
export const FAILURE_REASON_CODES = [
  "FILE_TOO_LARGE", "TOO_MANY_FILES", "BATCH_TOO_LARGE", "ENCRYPTED_PDF", "UNSUPPORTED_TYPE", "UNSUPPORTED_FILE_TYPE", "MAX_ATTEMPTS",
  "EMPTY_FILE", "EXECUTABLE_CONTENT", "SVG_NOT_ALLOWED", "MIME_MISMATCH", "SIZE_MISMATCH", "UPLOAD_MISSING", "CORRUPT", "TOO_MANY_PAGES",
  "UPLOAD_EXPIRED", "LEASE_EXPIRED", "BATCH_CANCELLED", "OPERATOR_SKIP", "DUPLICATE_SKIP", "DUPLICATE_LINK", "INFECTED",
] as const;

/** i18n key (under bulkScan) of the human sentence for a reason code. Unknown codes fall back to a generic sentence, never the raw code. */
export function failureReasonKey(code: string | null | undefined): string {
  if (!code) return "reason.unknown";
  return (FAILURE_REASON_CODES as readonly string[]).includes(code) ? `reason.${code}` : "reason.unknown";
}

/** The sentence explaining why a file is not progressing: failure reason, quarantine, malware-scan hold or duplicate. */
export function fileIssueKey(f: Pick<BatchFileView, "state" | "failureReason" | "deadLetter">): string | null {
  if (f.state === "quarantined") return "reason.quarantined";
  if (f.state === "scan_pending") return "reason.scan_pending";
  if (f.state === "skipped_duplicate") return "reason.skipped_duplicate";
  if (f.state === "failed") return f.deadLetter && !f.failureReason ? "reason.MAX_ATTEMPTS" : failureReasonKey(f.failureReason);
  return null;
}

/** Mirrors document-service state.ts PERMANENT_FAILURE_REASONS: the content itself is rejected, retrying cannot help. */
export const PERMANENT_FAILURE_REASONS: readonly string[] = [
  "EMPTY_FILE", "EXECUTABLE_CONTENT", "SVG_NOT_ALLOWED", "UNSUPPORTED_FILE_TYPE", "ENCRYPTED_PDF", "MIME_MISMATCH",
  "FILE_TOO_LARGE", "SIZE_MISMATCH", "UPLOAD_MISSING", "CORRUPT", "TOO_MANY_PAGES", "UNSUPPORTED_TYPE", "UPLOAD_EXPIRED",
];
/** Mirrors SKIPPABLE_STATES. */
export const SKIPPABLE_STATES: readonly string[] = ["pending_upload", "scan_pending", "queued", "needs_review", "failed"];

export function isRetryable(f: Pick<BatchFileView, "state" | "failureReason">): boolean {
  return f.state === "failed" && !!f.failureReason && !PERMANENT_FAILURE_REASONS.includes(f.failureReason);
}
export function isSkippable(f: Pick<BatchFileView, "state">): boolean {
  return SKIPPABLE_STATES.includes(f.state);
}

// ── polling + progress ──────────────────────────────────────────

/** States in which the pipeline (not a human) still has work to do, so the page keeps refreshing. */
export const ACTIVE_STATES: readonly string[] = ["pending_upload", "uploaded", "scanning", "scan_pending", "queued", "ocr_running", "extracted"];

export function hasActiveWork(counts: Record<string, number>, status?: string): boolean {
  if (status === "cancelled") return false;
  return ACTIVE_STATES.some((s) => (counts[s] ?? 0) > 0);
}

/** Exponential backoff: base, base*factor, ... capped. `attempt` is the number of consecutive unchanged/failed polls. */
export function pollDelayMs(attempt: number, opts: { baseMs?: number; factor?: number; maxMs?: number } = {}): number {
  const { baseMs = 3000, factor = 1.6, maxMs = 30000 } = opts;
  const n = Math.max(0, Math.floor(attempt));
  return Math.min(maxMs, Math.round(baseMs * Math.pow(factor, n)));
}

/** States the pipeline has settled on for a file (humans or nobody act next); mirrors PIPELINE_SETTLED_STATES. */
export const SETTLED_STATES: readonly string[] = ["needs_review", "ready_to_file", "filed", "failed", "quarantined", "skipped_duplicate", "skipped", "cancelled"];

export function progressFromCounts(counts: Record<string, number>): BatchProgress {
  const total = Object.values(counts).reduce((a, n) => a + (Number.isFinite(n) ? n : 0), 0);
  const settled = SETTLED_STATES.reduce((a, s) => a + (counts[s] ?? 0), 0);
  return { total, settled, percent: total === 0 ? 0 : Math.round((settled / total) * 100) };
}

/** Counts grouped for the batches list / detail summary. Order is the display order. */
export const COUNT_GROUPS: ReadonlyArray<{ id: string; states: readonly string[]; tone: Tone }> = [
  { id: "processing", states: ["pending_upload", "uploaded", "scanning", "queued", "ocr_running", "extracted"], tone: "info" },
  { id: "held", states: ["scan_pending"], tone: "warn" },
  { id: "review", states: ["needs_review"], tone: "warn" },
  { id: "ready", states: ["ready_to_file"], tone: "good" },
  { id: "filed", states: ["filed"], tone: "good" },
  { id: "failed", states: ["failed", "quarantined"], tone: "bad" },
  { id: "skipped", states: ["skipped", "skipped_duplicate", "cancelled"], tone: "mut" },
];

export function groupedCounts(counts: Record<string, number>): Array<{ id: string; count: number; tone: Tone }> {
  return COUNT_GROUPS.map((g) => ({ id: g.id, tone: g.tone, count: g.states.reduce((a, s) => a + (counts[s] ?? 0), 0) }));
}

export function formatBytes(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n) || n < 0) return "—";
  if (n < 1024) return `${n} B`;
  const units = ["KB", "MB", "GB", "TB"];
  let v = n / 1024;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

/** Confidence ratio (0..1) -> pill band. Thresholds follow the per-tenant review threshold when given. */
export type ConfidenceBand = "high" | "medium" | "low" | "unknown";
export function confidenceBand(c: number | null | undefined, threshold = 0.8): ConfidenceBand {
  if (c === null || c === undefined || !Number.isFinite(c)) return "unknown";
  if (c >= threshold) return "high";
  if (c >= threshold - 0.2) return "medium";
  return "low";
}
export const BAND_META: Record<ConfidenceBand, { tone: Tone; icon: string }> = {
  high: { tone: "good", icon: "✓" },
  medium: { tone: "warn", icon: "~" },
  low: { tone: "bad", icon: "!" },
  unknown: { tone: "mut", icon: "?" },
};

// ── review reasons ──────────────────────────────────────────────

export interface ReasonDescriptor {
  /** i18n key under bulkScan */
  key: string;
  params: Record<string, string>;
}

/** Link-step reasons the target service / checker can return (shown to reviewers when a file is sent back to review). */
export const LINK_REASON_CODES = [
  "TARGET_NOT_FOUND", "TARGET_KIND_MISMATCH", "TARGET_CLASSIFIED", "FILE_CLOSED", "DOCUMENT_ALREADY_LINKED", "EMPLOYEE_NOT_FOUND",
  "UNSUPPORTED_TARGET", "LINK_ALREADY_USED", "AMOUNT_MISMATCH", "REFERENCE_MISMATCH", "MISSING_MATCH_HINT", "LINK_NOT_FOUND", "LINK_ALREADY_UNLINKED",
  "REASON_REQUIRED", "MAKER_CHECKER_VIOLATION", "CHECKER_REJECTED", "REJECTED",
] as const;

export const REVIEW_REASON_CODES = ["LOW_CONFIDENCE", "CLASSIFICATION_UNCERTAIN", "PII_DETECTED", "MISSING_FIELD", "DEGRADED"] as const;

/**
 * Human-readable description for a review reason code: LOW_CONFIDENCE, CLASSIFICATION_UNCERTAIN, PII_DETECTED,
 * MISSING_FIELD:<kind>, DEGRADED:<detail> and LINK_<code>. Unknown codes get a generic sentence, never the raw code.
 */
export function describeReviewReason(code: string): ReasonDescriptor {
  if (code.startsWith("LINK_")) {
    // "LINK_<code>" is how a link problem is recorded on a file's review reasons; the bare codes LINK_NOT_FOUND / LINK_ALREADY_* are also valid.
    const stripped = code.slice(5).toUpperCase();
    const known = (c: string): boolean => (LINK_REASON_CODES as readonly string[]).includes(c);
    if (known(stripped)) return { key: `linkReason.${stripped}`, params: {} };
    return known(code.toUpperCase()) ? { key: `linkReason.${code.toUpperCase()}`, params: {} } : { key: "linkReason.unknown", params: {} };
  }
  const [base, ...rest] = code.split(":");
  const detail = rest.join(":");
  if (base === "MISSING_FIELD") return { key: "reviewReason.MISSING_FIELD", params: { field: detail } };
  if (base === "DEGRADED") return { key: "reviewReason.DEGRADED", params: { detail } };
  return (REVIEW_REASON_CODES as readonly string[]).includes(base ?? "") ? { key: `reviewReason.${base}`, params: {} } : { key: "reviewReason.unknown", params: {} };
}
