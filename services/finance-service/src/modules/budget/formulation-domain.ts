/**
 * SVC-031 — Budget formulation & consolidation pure domain.
 *
 * Department proposals are raised against a communicated ceiling, justified,
 * versioned, reviewed and approved (maker-checker), then consolidated across
 * heads for a financial year. No DB, no HTTP, no queue.
 */
import { DomainError } from "./domain.js";

export type ProposalStatus =
  | "draft" | "submitted" | "under_review" | "returned" | "approved";

/** Amount by which a proposal exceeds its ceiling (0 when within ceiling). */
export function ceilingBreachMinor(ceilingMinor: bigint, proposedMinor: bigint): bigint {
  const breach = proposedMinor - ceilingMinor;
  return breach > 0n ? breach : 0n;
}

export interface ProposalInput {
  ceilingMinor: bigint;
  proposedMinor: bigint;
  justification: string;
}

/**
 * A proposal must demand a positive amount. A proposal that stays within its
 * ceiling is always valid. A proposal that BREACHES the ceiling is permitted
 * only when it carries a substantive justification (>= 10 chars) — this is the
 * "proposal vs ceiling, with justification" control. An unjustified breach is
 * rejected outright.
 */
export function assertProposalValid(p: ProposalInput): void {
  if (p.proposedMinor <= 0n) {
    throw new DomainError("INVALID_PROPOSAL", "proposed amount must be positive");
  }
  if (p.ceilingMinor < 0n) {
    throw new DomainError("INVALID_PROPOSAL", "ceiling must not be negative");
  }
  const breach = ceilingBreachMinor(p.ceilingMinor, p.proposedMinor);
  if (breach > 0n && p.justification.trim().length < 10) {
    throw new DomainError(
      "CEILING_BREACH",
      `proposal exceeds ceiling by ${breach} paise and requires a justification of at least 10 characters`,
    );
  }
}

/** Monotonic proposal version bump for a revision. */
export function nextVersion(current: number): number {
  return current + 1;
}

/**
 * Allowed proposal lifecycle transitions. Enforced so a proposal cannot skip
 * review or be approved out of a terminal/invalid state.
 */
const TRANSITIONS: Record<ProposalStatus, ProposalStatus[]> = {
  draft:        ["submitted"],
  submitted:    ["under_review", "returned", "approved"],
  under_review: ["approved", "returned"],
  returned:     ["submitted"],
  approved:     [],
};

export function assertProposalTransition(from: ProposalStatus, to: ProposalStatus): void {
  if (!TRANSITIONS[from]?.includes(to)) {
    throw new DomainError(
      "INVALID_TRANSITION",
      `cannot move proposal from '${from}' to '${to}'`,
    );
  }
}

/**
 * Maker-checker on approval: a proposal must be approved by an officer other
 * than the one who raised it.
 */
export function assertProposalApproverDistinct(createdBy: string, approverId: string): void {
  if (createdBy === approverId) {
    throw new DomainError(
      "MAKER_CHECKER_VIOLATION",
      "proposal approver must differ from the officer who raised it (maker-checker)",
    );
  }
}

export interface ConsolidationLine {
  ceilingMinor: bigint;
  proposedMinor: bigint;
}

export interface Consolidation {
  count: number;
  totalCeilingMinor: bigint;
  totalProposedMinor: bigint;
  totalBreachMinor: bigint;
}

/**
 * Consolidate a set of proposals: sum ceilings and proposed demands, and the
 * total breach (the demand above the aggregate ceiling that must be funded from
 * additional resources or trimmed). Pure summation over BigInt — no float.
 */
export function consolidateProposals(lines: ConsolidationLine[]): Consolidation {
  let totalCeilingMinor = 0n;
  let totalProposedMinor = 0n;
  for (const l of lines) {
    totalCeilingMinor += l.ceilingMinor;
    totalProposedMinor += l.proposedMinor;
  }
  return {
    count: lines.length,
    totalCeilingMinor,
    totalProposedMinor,
    totalBreachMinor: ceilingBreachMinor(totalCeilingMinor, totalProposedMinor),
  };
}
