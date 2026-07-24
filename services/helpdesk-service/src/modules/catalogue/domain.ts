/**
 * Service Catalogue (SVC-129) — pure domain logic.
 *
 * Covers:
 *  - request-form validation against an offering's form schema
 *  - fulfilment stage state machine (ordered, strictly-forward transitions)
 *  - request status state machine
 *  - maker-checker rule for catalogue approvals (maker != checker)
 *  - SLA target resolution + breach detection (REUSES the sla/ engine — no SLA
 *    math is reinvented here) and OLA / underpinning-contract target resolution
 *
 * All functions are pure and deterministic (time is always injected).
 */
import {
  computeDeadlines,
  evaluateSlaStatus,
  isBreached,
  type SlaPolicy,
  type SlaDeadlines,
  type SlaEvalStatus,
} from "../sla/domain.js";

// ── Types ───────────────────────────────────────────────────────────────────

export type FieldType = "text" | "textarea" | "number" | "select" | "boolean";

/** A single field in an offering's request form schema. */
export interface FormField {
  key: string;
  label: string;
  type: FieldType;
  required?: boolean;
  /** Allowed values when type === "select". */
  options?: string[];
}

/** An ordered fulfilment-workflow stage. */
export interface FulfilmentStage {
  key: string;
  name: string;
  /** Role expected to action this stage (informational — assignment routing). */
  assigneeRole?: string | null;
}

/** OLA / underpinning-contract target sitting behind an SLA. */
export interface OlaTarget {
  id: string;
  name: string;
  kind: "ola" | "uc";
  provider: string;
  targetMinutes: number;
}

export type RequestStatus =
  | "pending_approval"
  | "approved"
  | "rejected"
  | "pending_fulfilment"
  | "in_fulfilment"
  | "fulfilled"
  | "cancelled";

export type ApprovalDecision = "approved" | "rejected";

// ── Request-form validation ───────────────────────────────────────────────────

/**
 * Validate submitted form data against an offering's request form schema.
 * Returns a list of human-readable error strings (empty array === valid).
 * Unknown extra keys are ignored; only declared fields are checked.
 */
export function validateFormData(schema: FormField[], data: Record<string, unknown>): string[] {
  const errors: string[] = [];
  for (const f of schema) {
    const v = data[f.key];
    const missing = v === undefined || v === null || v === "";
    if (f.required && missing) {
      errors.push(`Missing required field: ${f.label}`);
      continue;
    }
    if (missing) continue;
    switch (f.type) {
      case "number":
        if (
          typeof v !== "number" &&
          !(typeof v === "string" && v.trim() !== "" && !Number.isNaN(Number(v)))
        ) {
          errors.push(`Field '${f.label}' must be a number`);
        }
        break;
      case "boolean":
        if (typeof v !== "boolean") errors.push(`Field '${f.label}' must be a boolean`);
        break;
      case "select":
        if (f.options && f.options.length > 0 && !f.options.includes(String(v))) {
          errors.push(`Field '${f.label}' must be one of: ${f.options.join(", ")}`);
        }
        break;
      default: // text | textarea
        if (typeof v !== "string") errors.push(`Field '${f.label}' must be text`);
    }
  }
  return errors;
}

// ── Fulfilment stage state machine ────────────────────────────────────────────

export function stageKeys(stages: FulfilmentStage[]): string[] {
  return stages.map((s) => s.key);
}

export function firstStage(stages: FulfilmentStage[]): FulfilmentStage | null {
  return stages[0] ?? null;
}

/** True when `key` is the final stage in the workflow. */
export function isTerminalStage(stages: FulfilmentStage[], key: string): boolean {
  const keys = stageKeys(stages);
  return keys.length > 0 && keys[keys.length - 1] === key;
}

/** The stage immediately following `current`, or null if `current` is last/unknown. */
export function nextStage(stages: FulfilmentStage[], current: string): FulfilmentStage | null {
  const keys = stageKeys(stages);
  const i = keys.indexOf(current);
  if (i < 0 || i >= keys.length - 1) return null;
  return stages[i + 1]!;
}

/**
 * A stage transition is valid only when `to` is the immediate next stage after
 * `from` — strictly forward, adjacent, no skipping and no going back.
 */
export function canAdvanceStage(stages: FulfilmentStage[], from: string, to: string): boolean {
  const nxt = nextStage(stages, from);
  return nxt !== null && nxt.key === to;
}

/**
 * A request may be marked fulfilled when it has no fulfilment stages (nothing to
 * work through) or when it has reached its terminal stage.
 */
export function canFulfil(stages: FulfilmentStage[], currentStage: string | null): boolean {
  if (stages.length === 0) return true;
  return currentStage !== null && isTerminalStage(stages, currentStage);
}

// ── Request status state machine ──────────────────────────────────────────────

const REQUEST_TRANSITIONS: Record<RequestStatus, RequestStatus[]> = {
  pending_approval: ["approved", "rejected", "cancelled"],
  approved: ["in_fulfilment", "pending_fulfilment", "cancelled"],
  pending_fulfilment: ["in_fulfilment", "fulfilled", "cancelled"],
  in_fulfilment: ["in_fulfilment", "fulfilled", "cancelled"],
  fulfilled: [],
  rejected: [],
  cancelled: [],
};

export function canTransitionRequest(from: RequestStatus, to: RequestStatus): boolean {
  return (REQUEST_TRANSITIONS[from] ?? []).includes(to);
}

/**
 * The initial (status, stage) of a freshly raised request: goes to approval when
 * the offering requires it, otherwise straight into fulfilment at the first stage
 * (or pending_fulfilment when the offering defines no stages).
 */
export function initialRequestState(
  approvalRequired: boolean,
  stages: FulfilmentStage[],
): { status: RequestStatus; stage: string | null } {
  if (approvalRequired) return { status: "pending_approval", stage: null };
  const first = firstStage(stages);
  return first ? { status: "in_fulfilment", stage: first.key } : { status: "pending_fulfilment", stage: null };
}

/** The (status, stage) a request moves to after an approval decision. */
export function stateAfterApproval(
  decision: ApprovalDecision,
  stages: FulfilmentStage[],
): { status: RequestStatus; stage: string | null } {
  if (decision === "rejected") return { status: "rejected", stage: null };
  const first = firstStage(stages);
  return first ? { status: "in_fulfilment", stage: first.key } : { status: "pending_fulfilment", stage: null };
}

// ── Maker-checker ─────────────────────────────────────────────────────────────

/**
 * Maker-checker rule: the checker approving/rejecting a request must NOT be the
 * maker who raised it. Returns true when the checker is a distinct actor.
 */
export function isDistinctChecker(makerId: string, checkerId: string): boolean {
  return makerId.toLowerCase() !== checkerId.toLowerCase();
}

// ── SLA / OLA target resolution (reuses sla/ engine) ──────────────────────────

/** Resolve response + resolution deadlines for a request. Delegates to sla-engine. */
export function resolveSlaTargets(createdAt: Date, policy: SlaPolicy): SlaDeadlines {
  return computeDeadlines(createdAt, policy);
}

/** Evaluate a request's live SLA status against its policy. Delegates to sla-engine. */
export function evaluateRequestSla(
  now: Date,
  createdAt: Date,
  policy: SlaPolicy,
): { status: SlaEvalStatus; deadlines: SlaDeadlines } {
  return evaluateSlaStatus(now, createdAt, policy);
}

/**
 * OLA target resolution: the tightest (smallest target_minutes) OLA / UC behind
 * the SLA — the internal target that must be met to protect the customer-facing
 * SLA. Returns null when no OLA/UC is configured.
 */
export function resolveOlaTarget(olas: OlaTarget[]): OlaTarget | null {
  if (olas.length === 0) return null;
  return olas.reduce((a, b) => (b.targetMinutes < a.targetMinutes ? b : a));
}

/**
 * Whether a request should trigger a breach escalation right now: its resolution
 * deadline has passed and it has not already been escalated.
 */
export function shouldEscalateBreach(
  now: Date,
  resolutionDeadline: Date | null,
  alreadyEscalated: boolean,
): boolean {
  if (alreadyEscalated || !resolutionDeadline) return false;
  return isBreached(now, resolutionDeadline);
}
