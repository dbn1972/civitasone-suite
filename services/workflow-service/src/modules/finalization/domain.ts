/**
 * CAP-029 — Finalization / reversal / unfinalization control (pure domain).
 *
 * Once an instance is FINALIZED its record is protected from further edits. A
 * reversal (unfinalization) is a privileged, guarded act: it requires reversal
 * authority, a non-empty reason, and that no blocking downstream dependency
 * exists — and it produces an impact assessment enumerating what a reversal
 * would touch. This module is the pure guard + assessment logic; persistence,
 * authority lookup and audit are the caller's responsibility.
 */

export interface FinalizationState {
  instanceId: string;
  finalized: boolean;
  finalizedBy: string | null;
  finalizedAt: string | null;
  reversed: boolean;
  reversedBy: string | null;
  reversedAt: string | null;
}

export interface Dependency {
  /** e.g. 'payment', 'ledger_posting', 'downstream_case'. */
  type: string;
  id: string;
  /** A dependency that must be undone/settled first blocks reversal. */
  blocking: boolean;
  detail?: string;
}

export interface ReverseRequest {
  state: FinalizationState;
  /** Does the actor hold reversal authority (resolved upstream)? */
  hasAuthority: boolean;
  reason: string | null | undefined;
  dependencies: Dependency[];
}

export interface GuardResult {
  allowed: boolean;
  errors: string[];
}

/**
 * Guard an edit/mutation against finalization: a finalized-and-not-reversed
 * instance is immutable. Returns allowed=false with a stable error code string
 * so routes can 409 consistently.
 */
export function assertEditable(state: FinalizationState | null): GuardResult {
  if (state && state.finalized && !state.reversed) {
    return { allowed: false, errors: ["INSTANCE_FINALIZED"] };
  }
  return { allowed: true, errors: [] };
}

/** True when the instance is currently in the protected (finalized) state. */
export function isProtected(state: FinalizationState | null): boolean {
  return !!state && state.finalized && !state.reversed;
}

/**
 * Decide whether a reversal may proceed. All applicable failures are collected
 * (not short-circuited) so the caller can surface every reason at once.
 */
export function canReverse(req: ReverseRequest): GuardResult {
  const errors: string[] = [];
  const { state } = req;

  if (!state.finalized) errors.push("NOT_FINALIZED");
  if (state.reversed) errors.push("ALREADY_REVERSED");
  if (!req.hasAuthority) errors.push("NO_REVERSAL_AUTHORITY");
  if (!req.reason || req.reason.trim().length === 0) errors.push("REASON_REQUIRED");

  const blockers = req.dependencies.filter((d) => d.blocking);
  if (blockers.length > 0) errors.push("BLOCKING_DEPENDENCIES");

  return { allowed: errors.length === 0, errors };
}

export interface ImpactAssessment {
  instanceId: string;
  dependentCount: number;
  blockingCount: number;
  dependents: Dependency[];
  /** True when reversal is clear of blocking dependencies. */
  reversible: boolean;
  summary: string;
}

/**
 * Enumerate the blast radius of a reversal: every dependency that would be
 * affected, how many block the reversal, and a human summary. Pure — the caller
 * supplies the dependency set (queried from this and other services).
 */
export function assessImpact(instanceId: string, dependencies: Dependency[]): ImpactAssessment {
  const blocking = dependencies.filter((d) => d.blocking);
  const reversible = blocking.length === 0;
  const summary = reversible
    ? `${dependencies.length} dependent record(s); none block reversal`
    : `${blocking.length} blocking dependency(ies) must be settled before reversal`;
  return {
    instanceId,
    dependentCount: dependencies.length,
    blockingCount: blocking.length,
    dependents: dependencies,
    reversible,
    summary,
  };
}
