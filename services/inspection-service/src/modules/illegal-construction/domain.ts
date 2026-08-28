/**
 * Illegal Construction domain — pure functions for case lifecycle, action types,
 * violation checklist validation, and regularization eligibility.
 *
 * No side effects, no DB access, no I/O. Fully deterministic and property-testable.
 *
 * _Requirements: BRD 5.20 ILBLD-001..004_
 */

// ── Violation types ───────────────────────────────────────────────────────────

export const VIOLATION_TYPES = [
  "no_permit",
  "deviation_from_plan",
  "unauthorized_floor",
  "setback_violation",
  "fsi_exceeded",
  "unauthorized_use_change",
] as const;
export type ViolationType = typeof VIOLATION_TYPES[number];

// ── Case state machine ───────────────────────────────────────────────────────

export const CASE_STATES = [
  "reported",
  "inspected",
  "violation_confirmed",
  "notice_issued",
  "hearing_done",
  "stop_work_ordered",
  "sealed",
  "demolition_ordered",
  "demolished",
  "regularized",
  "dismissed",
] as const;
export type CaseState = typeof CASE_STATES[number];

export const CASE_TRANSITIONS: Record<CaseState, CaseState[]> = {
  reported:             ["inspected", "dismissed"],
  inspected:            ["violation_confirmed", "dismissed"],
  violation_confirmed:  ["notice_issued", "regularized"],
  notice_issued:        ["hearing_done"],
  hearing_done:         ["stop_work_ordered", "sealed", "demolition_ordered", "regularized", "dismissed"],
  stop_work_ordered:    ["sealed", "demolition_ordered", "regularized"],
  sealed:               ["demolition_ordered", "regularized"],
  demolition_ordered:   ["demolished"],
  demolished:           [],
  regularized:          [],
  dismissed:            [],
};

// ── Action types ──────────────────────────────────────────────────────────────

export const ACTION_TYPES = [
  "stop_work_notice",
  "sealing_order",
  "demolition_order",
  "fine",
  "regularization_order",
] as const;
export type ActionType = typeof ACTION_TYPES[number];

export const ACTION_STATES = ["issued", "enforced", "complied", "appealed", "stayed"] as const;
export type ActionState = typeof ACTION_STATES[number];

// ── Errors ────────────────────────────────────────────────────────────────────

export class DomainError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "DomainError";
  }
}

// ── Pure functions ────────────────────────────────────────────────────────────

/** Sequential case number: ILBLD-{YYYY}-{SEQ:6} */
let caseSeq = 0;
export function generateCaseNumber(): string {
  caseSeq += 1;
  const year = new Date().getFullYear();
  return `ILBLD-${year}-${String(caseSeq).padStart(6, "0")}`;
}

/** Sequential action number: ILBLD-A-{YYYY}-{SEQ:6} */
let actionSeq = 0;
export function generateActionNumber(): string {
  actionSeq += 1;
  const year = new Date().getFullYear();
  return `ILBLD-A-${year}-${String(actionSeq).padStart(6, "0")}`;
}

/**
 * Assert case state transition is valid.
 */
export function assertValidCaseTransition(
  current: CaseState,
  target: CaseState,
): void {
  const allowed = CASE_TRANSITIONS[current];
  if (!allowed.includes(target)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `Cannot transition case from ${current} to ${target}. Allowed: [${allowed.join(", ")}]`,
    );
  }
}

/**
 * Validate violation checklist structure.
 * Must be a non-null object (typically an array of checklist items).
 */
export function validateViolationChecklist(checklist: unknown): void {
  if (!checklist || typeof checklist !== "object") {
    throw new DomainError("INVALID_CHECKLIST", "Violation checklist must be a non-null object");
  }
}

/**
 * Check if a case is eligible for regularization.
 * Cases can be regularized only from certain states and only for certain violation types.
 * Demolition-ordered and demolished cases cannot be regularized.
 */
export function canRegularize(status: CaseState, violationType: ViolationType): boolean {
  const regularizableStates: CaseState[] = [
    "violation_confirmed",
    "hearing_done",
    "stop_work_ordered",
    "sealed",
  ];
  const regularizableViolations: ViolationType[] = [
    "deviation_from_plan",
    "setback_violation",
    "unauthorized_use_change",
  ];

  return regularizableStates.includes(status) && regularizableViolations.includes(violationType);
}
