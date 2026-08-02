/**
 * FRM-07 — maker-checker publish state machine for form versions. Pure, so the
 * separation-of-duties and immutability rules are unit-testable without a
 * database, and the route layer only has to map the returned error code to an
 * HTTP status.
 *
 *   draft ──submit──▶ pending_approval ──approve──▶ published ──▶ superseded
 *     ▲                      │                         │
 *     └──────reject──────────┘                         └── revise ─▶ new draft
 *
 * Two invariants are enforced here rather than in SQL because both need to know
 * *who* is acting:
 *
 *   1. SEPARATION OF DUTIES — the actor who submitted a version for approval
 *      cannot approve it. The submitter is recorded on submit and compared on
 *      approve. Falling back to `createdBy` when `submittedBy` is somehow null
 *      keeps the check fail-closed rather than fail-open.
 *
 *   2. IMMUTABILITY — a published version is frozen. Any edit attempt is
 *      refused; the caller must create a new draft version from it (`revise`).
 *      This is what makes a published form auditable: the exact definition a
 *      citizen submitted against still exists, byte for byte.
 */

export type FormVersionStatus = "draft" | "pending_approval" | "published" | "superseded";

export const FORM_VERSION_STATUSES: readonly FormVersionStatus[] = [
  "draft",
  "pending_approval",
  "published",
  "superseded",
];

export interface FormVersionState {
  status: FormVersionStatus;
  createdBy: string;
  submittedBy: string | null;
  publishedBy: string | null;
}

/** A refusal: `code` is the API error code, `status` the HTTP status to return. */
export interface TransitionRefusal {
  ok: false;
  status: number;
  code: string;
  message: string;
}

export interface TransitionAllowed {
  ok: true;
  next: FormVersionStatus;
}

export type TransitionResult = TransitionAllowed | TransitionRefusal;

/** True when the version must never be mutated in place. */
export function isImmutable(status: FormVersionStatus): boolean {
  return status === "published" || status === "superseded";
}

/**
 * Guard for any in-place edit (PATCH) of a version. Published and superseded
 * versions are frozen — 409 rather than 403, because the request is well-formed
 * and authorised, it just conflicts with the version's state.
 */
export function assertEditable(state: FormVersionState): TransitionResult {
  if (isImmutable(state.status)) {
    return {
      ok: false,
      status: 409,
      code: "VERSION_IMMUTABLE",
      message: `a ${state.status} form version cannot be edited — create a new draft version instead`,
    };
  }
  if (state.status === "pending_approval") {
    return {
      ok: false,
      status: 409,
      code: "VERSION_PENDING_APPROVAL",
      message: "a version awaiting approval cannot be edited — withdraw it first",
    };
  }
  return { ok: true, next: state.status };
}

/** draft → pending_approval. */
export function canSubmit(state: FormVersionState): TransitionResult {
  if (state.status !== "draft") {
    return {
      ok: false,
      status: 409,
      code: "INVALID_STATE",
      message: `only a draft version can be submitted for approval (current: ${state.status})`,
    };
  }
  return { ok: true, next: "pending_approval" };
}

/**
 * pending_approval → published, subject to separation of duties.
 *
 * Returns 403 MAKER_CANNOT_CHECK when the approver is the submitter (or, if no
 * submitter was recorded, the author). Returns 409 when the version is not
 * awaiting approval — including a second approve of an already-published
 * version, which must not silently re-stamp publishedBy.
 */
export function canApprove(state: FormVersionState, approverId: string): TransitionResult {
  if (state.status === "published") {
    return { ok: false, status: 409, code: "ALREADY_PUBLISHED", message: "form version is already published" };
  }
  if (state.status !== "pending_approval") {
    return {
      ok: false,
      status: 409,
      code: "INVALID_STATE",
      message: `only a version awaiting approval can be published (current: ${state.status})`,
    };
  }
  const maker = state.submittedBy ?? state.createdBy;
  if (maker === approverId) {
    return {
      ok: false,
      status: 403,
      code: "MAKER_CANNOT_CHECK",
      message: "the actor who submitted this form version cannot approve it — a different actor must approve",
    };
  }
  return { ok: true, next: "published" };
}

/** pending_approval → draft (send back to the maker). */
export function canReject(state: FormVersionState): TransitionResult {
  if (state.status !== "pending_approval") {
    return {
      ok: false,
      status: 409,
      code: "INVALID_STATE",
      message: `only a version awaiting approval can be rejected (current: ${state.status})`,
    };
  }
  return { ok: true, next: "draft" };
}

/**
 * Any version may be revised: revising produces a NEW draft version carrying a
 * copy of the source definition. Revising is therefore always allowed and never
 * mutates the source — that is precisely how a published version stays
 * immutable while the form keeps evolving.
 */
export function canRevise(_state: FormVersionState): TransitionResult {
  return { ok: true, next: "draft" };
}

/** Next version number for a form given the numbers already used. */
export function nextVersionNumber(existing: number[]): number {
  return existing.reduce((max, n) => (n > max ? n : max), 0) + 1;
}
