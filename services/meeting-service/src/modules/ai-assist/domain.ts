/**
 * AI-assist module — pure domain logic (no I/O, no side effects, fully unit/property testable).
 *
 * This is the safety core of the AI-assist feature. Two invariants dominate every code path
 * and are the reason this logic lives in a pure, independently-testable module:
 *
 *   1. Confidence gate (Req 17.x, design "AI-Assisted Minutes Drafting Flow"):
 *      a transcription is only accepted as authoritative when the provider's confidence is
 *      ≥ 0.70. Below the threshold the service falls back to the MANUAL workflow and notifies
 *      the secretary — it never silently stores a low-confidence transcript as the record.
 *
 *   2. Human-approval invariant — "AI never auto-publishes" (P37, steering):
 *      every artifact the AI produces is advisory. AI-generated minutes are ALWAYS created as
 *      an editable `draft` marked `ai_generated = true`; they can NEVER be emitted in an
 *      approved / signed / circulated state by the AI path. Extracted action items are stored
 *      as CANDIDATES pending explicit human confirmation and are never inserted as live
 *      action items. `buildAiMinutesDraft` / `assertAiMinutesNeverAutoApproved` encode this so
 *      no consumer can accidentally bypass it.
 *
 * All functions are deterministic given their inputs (callers inject `now` where time matters)
 * and raise the service's typed `HttpError` (via `httpError`) on a domain-rule violation so the
 * standard error envelope + HTTP status contract is preserved end-to-end.
 *
 * _Requirements: 7.2 (AI template), 17.1, 17.2, 17.3, 17.4, 17.5, 17.6_
 */
import { createHash } from "node:crypto";
import { httpError } from "../../shared/context.js";
import { MINUTES_TEMPLATE_TYPES, type MinutesTemplateType } from "../minutes/domain.js";

// ─── Confidence gate (Req 17.x · design confidence ≥ 0.70) ───────────────────

/**
 * Minimum provider confidence for an AI transcription to be accepted as authoritative.
 * Below this the flow degrades to the manual workflow (secretary drafts minutes by hand) and
 * the low-confidence transcript is NOT persisted as the record of proceedings.
 */
export const AI_CONFIDENCE_THRESHOLD = 0.7;

/** Marker used in notifications / audit metadata when a result is rejected by the gate. */
export const AI_LOW_CONFIDENCE = "AI_LOW_CONFIDENCE";
/** Marker used in notifications / audit metadata when the AI provider is unavailable. */
export const AI_UNAVAILABLE = "AI_UNAVAILABLE";

/**
 * Clamp/normalise a raw provider confidence into the closed unit interval [0, 1]. Providers may
 * report out-of-range or non-finite values; a non-finite input normalises to 0 (fails the gate)
 * so a broken provider can never be treated as high-confidence.
 */
export function normalizeConfidence(raw: number): number {
  if (!Number.isFinite(raw)) return 0;
  if (raw < 0) return 0;
  if (raw > 1) return 1;
  return raw;
}

/**
 * The confidence gate (design "alt Confidence ≥ 0.70"): true IFF the (normalised) confidence
 * meets the threshold and the transcription may be stored as authoritative. Anything below the
 * threshold must route to the manual fallback.
 */
export function meetsConfidenceThreshold(confidence: number, threshold: number = AI_CONFIDENCE_THRESHOLD): boolean {
  return normalizeConfidence(confidence) >= threshold;
}

// ─── Human-approval invariant — "AI never auto-publishes" (P37) ──────────────

/** The ONLY status an AI-generated minutes draft may be created in. */
export const AI_MINUTES_INITIAL_STATUS = "draft" as const;

/**
 * Minutes statuses that represent human-authorised, published states. The AI path must never
 * produce a minutes row in any of these — reaching them requires an explicit human action
 * (chairperson approval / signing / circulation) handled by the minutes module.
 */
const HUMAN_AUTHORISED_MINUTES_STATUSES = ["approved", "signed", "circulated"] as const;

/** True when `status` is a human-authorised (published) minutes state. */
export function isHumanAuthorisedMinutesStatus(status: string): boolean {
  return (HUMAN_AUTHORISED_MINUTES_STATUSES as readonly string[]).includes(status);
}

/**
 * The shape an AI minutes draft must take when persisted. Encodes the human-approval invariant
 * in the type + values: `status` is pinned to `"draft"` and `aiGenerated` to `true`.
 */
export interface AiMinutesDraft {
  status: typeof AI_MINUTES_INITIAL_STATUS;
  aiGenerated: true;
  templateType: MinutesTemplateType;
  content: string;
}

/**
 * Build the persistence shape for an AI-generated minutes draft (Req 7.2, 17.x, P37). The
 * result is ALWAYS `{ status: "draft", aiGenerated: true }` regardless of provider output, so
 * an AI draft can never enter an approved/signed/circulated state through this path. The
 * template defaults to `summary` when the requested value is not a recognised template.
 */
export function buildAiMinutesDraft(content: string, requestedTemplate?: string): AiMinutesDraft {
  const templateType: MinutesTemplateType =
    requestedTemplate && (MINUTES_TEMPLATE_TYPES as readonly string[]).includes(requestedTemplate)
      ? (requestedTemplate as MinutesTemplateType)
      : "summary";
  return { status: AI_MINUTES_INITIAL_STATUS, aiGenerated: true, templateType, content };
}

/**
 * Guard that a minutes row the AI path is about to WRITE is not a human-authorised, published
 * document (Req 7.5, P37). AI drafting must not overwrite minutes a human has already approved,
 * signed, or circulated; the consumer calls this before touching an existing minutes row and
 * routes to the manual-fallback notification instead. Throws `MEETING_INVALID_TRANSITION` (422).
 */
export function assertAiMinutesNeverAutoApproved(existingStatus: string): void {
  if (isHumanAuthorisedMinutesStatus(existingStatus)) {
    throw httpError(
      "MEETING_INVALID_TRANSITION",
      "AI drafting cannot modify minutes that have already been approved/signed/circulated",
      { status: existingStatus },
    );
  }
}

// ─── Action-item candidates — pending human confirmation (Req 17.x) ──────────

/** A candidate action item extracted from a transcript. Advisory only — never a live task. */
export interface ActionCandidate {
  /** Human-readable action description. */
  description: string;
  /** Free-text assignee hint (name/role mentioned in the transcript); resolved by a human. */
  assigneeHint?: string;
  /** Free-text deadline hint (e.g. "next week"); resolved by a human. */
  deadlineHint?: string;
  /** Provider confidence for this candidate in [0, 1]. */
  confidence: number;
}

/**
 * The artifact persisted for AI-extracted actions (Req 17.x). Explicitly marked `pending`
 * confirmation and `aiGenerated`, so downstream never mistakes it for confirmed action items.
 */
export interface ActionCandidateArtifact {
  meetingId: string;
  aiGenerated: true;
  status: "pending_confirmation";
  candidates: ActionCandidate[];
  generatedAt: string;
}

/**
 * Normalise raw provider candidates into the pending-confirmation artifact (P37). Confidence is
 * clamped; blank descriptions are dropped. The artifact is always `status: "pending_confirmation"`
 * so a human must confirm each candidate before it becomes a real action item.
 */
export function buildActionCandidateArtifact(
  meetingId: string,
  raw: readonly ActionCandidate[],
  now: Date = new Date(),
): ActionCandidateArtifact {
  const candidates = raw
    .filter((c) => c.description && c.description.trim().length > 0)
    .map((c) => ({
      description: c.description.trim(),
      ...(c.assigneeHint ? { assigneeHint: c.assigneeHint } : {}),
      ...(c.deadlineHint ? { deadlineHint: c.deadlineHint } : {}),
      confidence: normalizeConfidence(c.confidence),
    }));
  return { meetingId, aiGenerated: true, status: "pending_confirmation", candidates, generatedAt: now.toISOString() };
}

// ─── Content hashing (document integrity, mirrors minutes) ───────────────────

/** SHA-256 of a text artifact as 64-char lowercase hex (fits `meeting_documents.hash`). */
export function computeHash(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

// ─── Object-storage key layout ───────────────────────────────────────────────

/** Storage key for a stored transcript artifact. */
export function transcriptStorageKey(tenantId: string, meetingId: string): string {
  return `ai/transcripts/${tenantId}/${meetingId}.txt`;
}

/** Storage key for a stored action-candidate artifact (JSON). */
export function actionCandidatesStorageKey(tenantId: string, meetingId: string): string {
  return `ai/action-candidates/${tenantId}/${meetingId}.json`;
}

// ─── Knowledge-base search result classification (Req 17.6) ──────────────────

/**
 * Match classification for knowledge-base search results (Req 17.6): keyword matches are
 * `exact`, vector/similarity matches are `semantic` ("related matches"). The route marks every
 * hit so the UI can distinguish exact keyword hits from semantic related matches.
 */
export type KnowledgeMatchType = "exact" | "semantic";

/**
 * Classify a hit as an exact keyword match or a semantic "related match" (Req 17.6). Heuristic
 * and pure: a hit whose title/content contains a query term (case-insensitive) is `exact`;
 * otherwise it is a `semantic` related match surfaced by similarity ranking.
 */
export function classifyMatch(query: string, title: string, content: string): KnowledgeMatchType {
  const terms = query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter((t) => t.length >= 3);
  if (terms.length === 0) return "semantic";
  const haystack = `${title} ${content}`.toLowerCase();
  return terms.some((t) => haystack.includes(t)) ? "exact" : "semantic";
}
