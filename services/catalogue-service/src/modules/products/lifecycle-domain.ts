/**
 * PC-002: Product lifecycle state machine with governance workflow.
 * States: draft → submitted → approved → active → suspended → retired → closed_to_new
 * Transitions are enforced by governance routes.
 */

export const GOVERNED_LIFECYCLE_STATUSES = [
  "draft",
  "submitted",
  "approved",
  "active",
  "suspended",
  "retired",
  "closed_to_new",
] as const;

export type GovernedLifecycleStatus = (typeof GOVERNED_LIFECYCLE_STATUSES)[number];

/** Allowed state transitions: key = current status, value = set of reachable statuses. */
const GOVERNED_TRANSITIONS: Record<GovernedLifecycleStatus, readonly GovernedLifecycleStatus[]> = {
  draft: ["submitted"],
  submitted: ["approved", "draft"], // rejected → back to draft
  approved: ["active"],
  active: ["suspended", "retired"],
  suspended: ["active", "retired"],
  retired: ["closed_to_new"],
  closed_to_new: [],
};

export function isGovernedStatus(s: string): s is GovernedLifecycleStatus {
  return (GOVERNED_LIFECYCLE_STATUSES as readonly string[]).includes(s);
}

export function isValidGovernedTransition(from: string, to: string): boolean {
  const allowed = GOVERNED_TRANSITIONS[from as GovernedLifecycleStatus];
  if (!allowed) return false;
  return (allowed as readonly string[]).includes(to);
}

export interface GovernedTransitionResult {
  valid: boolean;
  reason?: string;
}

export function validateGovernedTransition(from: string, to: string): GovernedTransitionResult {
  if (!isGovernedStatus(from)) {
    return { valid: false, reason: `Unknown current status: ${from}` };
  }
  if (!isGovernedStatus(to)) {
    return { valid: false, reason: `Unknown target status: ${to}` };
  }
  if (from === to) {
    return { valid: true };
  }
  if (!isValidGovernedTransition(from, to)) {
    return { valid: false, reason: `Cannot transition from '${from}' to '${to}'` };
  }
  return { valid: true };
}

/** Submit action: draft → submitted */
export function canSubmit(status: string): GovernedTransitionResult {
  return validateGovernedTransition(status, "submitted");
}

/** Approve action: submitted → approved */
export function canApprove(status: string): GovernedTransitionResult {
  return validateGovernedTransition(status, "approved");
}

/** Reject action: submitted → draft (rejection sends back to draft) */
export function canReject(status: string): GovernedTransitionResult {
  return validateGovernedTransition(status, "draft");
}

// ═══════════════════════════════════════════════════════════════════════════════
// PC-002 — catalogue.product_lifecycle state machine (PURE, no I/O)
//
// The state values below are taken verbatim from the CHECK constraint created in
// migration 0004:
//   CHECK (state IN ('active', 'sunset', 'closed_to_new_business', 'retired'))
// Do NOT add values here that the database will reject.
//
// Progression rationale (a product's commercial wind-down):
//   active                 — on sale, fully open
//   sunset                 — announced end-of-life, still sellable
//   closed_to_new_business — existing holdings serviced, no new sales
//   retired                — terminal, fully off the shelf
// A product may be pulled back from `sunset` to `active` (a sunset announcement
// can be withdrawn) but never from `closed_to_new_business` or `retired`, because
// reopening sales after closure is a new product decision, not a state flip.
// ═══════════════════════════════════════════════════════════════════════════════

/** Exact CHECK allowlist of catalogue.product_lifecycle.state (migration 0004). */
export const PRODUCT_LIFECYCLE_STATES = [
  "active",
  "sunset",
  "closed_to_new_business",
  "retired",
] as const;

export type ProductLifecycleState = (typeof PRODUCT_LIFECYCLE_STATES)[number];

/** The state a product enters when lifecycle tracking begins. */
export const INITIAL_LIFECYCLE_STATE: ProductLifecycleState = "active";

const LIFECYCLE_TRANSITIONS: Record<ProductLifecycleState, readonly ProductLifecycleState[]> = {
  active: ["sunset", "closed_to_new_business", "retired"],
  sunset: ["active", "closed_to_new_business", "retired"],
  closed_to_new_business: ["retired"],
  retired: [],
};

export function isProductLifecycleState(s: string): s is ProductLifecycleState {
  return (PRODUCT_LIFECYCLE_STATES as readonly string[]).includes(s);
}

/** States reachable from `from`. Empty array for unknown or terminal states. */
export function nextLifecycleStates(from: string): readonly ProductLifecycleState[] {
  if (!isProductLifecycleState(from)) return [];
  return LIFECYCLE_TRANSITIONS[from];
}

/** True when `from` has no outgoing transitions. */
export function isTerminalLifecycleState(state: string): boolean {
  return isProductLifecycleState(state) && LIFECYCLE_TRANSITIONS[state].length === 0;
}

export interface LifecycleTransitionCheck {
  valid: boolean;
  reason?: string;
}

/**
 * Validate a lifecycle transition. Pure — no DB, no clock, no randomness.
 *
 * `from` may be null to represent "no lifecycle history yet"; in that case only
 * the initial state is reachable, so the first row written is always `active`.
 * Self-transitions are rejected: re-declaring the current state is a no-op that
 * would otherwise append a meaningless history row.
 */
export function validateLifecycleTransition(from: string | null, to: string): LifecycleTransitionCheck {
  if (!isProductLifecycleState(to)) {
    return { valid: false, reason: `Unknown target lifecycle state: ${to}` };
  }
  if (from === null) {
    return to === INITIAL_LIFECYCLE_STATE
      ? { valid: true }
      : { valid: false, reason: `A product with no lifecycle history must start at '${INITIAL_LIFECYCLE_STATE}', not '${to}'` };
  }
  if (!isProductLifecycleState(from)) {
    return { valid: false, reason: `Unknown current lifecycle state: ${from}` };
  }
  if (from === to) {
    return { valid: false, reason: `Product is already in state '${to}'` };
  }
  if (!LIFECYCLE_TRANSITIONS[from].includes(to)) {
    return { valid: false, reason: `Cannot transition lifecycle from '${from}' to '${to}'` };
  }
  return { valid: true };
}

/** A product is open for new business only while active or in announced sunset. */
export function isOpenForNewBusiness(state: string): boolean {
  return state === "active" || state === "sunset";
}
