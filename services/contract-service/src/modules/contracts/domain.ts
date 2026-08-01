export class DomainError extends Error {
  constructor(public code: string, message: string) {
    super(`[${code}] ${message}`);
    this.name = "DomainError";
  }
}

/**
 * Government contract lifecycle.
 *   draft            — created, not yet sanctioned (maker).
 *   pending_approval — submitted to eOffice for award approval.
 *   approved         — sanctioned by a checker / eOffice, award signed, not yet live.
 *   active           — in force; deliverables/milestones run; amendments allowed here.
 *   closed           — completed normally (all obligations discharged).
 *   terminated       — ended early (default / convenience / breach); requires checker (SoD).
 */
export type ContractStatus =
  | "draft"
  | "pending_approval"
  | "approved"
  | "active"
  | "closed"
  | "terminated";

const VALID_TRANSITIONS: Record<ContractStatus, ContractStatus[]> = {
  draft:            ["pending_approval", "approved", "terminated"],
  pending_approval: ["approved", "terminated", "draft"],
  approved:         ["active", "terminated"],
  active:           ["closed", "terminated"],
  closed:           [],
  terminated:       [],
};

export function assertTransitionAllowed(from: string, to: ContractStatus): void {
  const allowed = VALID_TRANSITIONS[from as ContractStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new DomainError("INVALID_TRANSITION", `contract cannot transition from '${from}' to '${to}'`);
  }
}

/** Segregation of duties: the approver/terminator (checker) must differ from the creator (maker). */
export function assertDistinctMakerChecker(creatorId: string, approverId: string): void {
  if (creatorId && approverId && creatorId === approverId) {
    throw new DomainError("SOD_VIOLATION", "maker and checker must be different actors (self-approval rejected)");
  }
}

/** Amendments (variations) are only valid on a contract that is in force. */
export function assertCanAmend(status: string): void {
  if (status !== "active") {
    throw new DomainError("INVALID_STATUS", `only active contracts can be amended, got '${status}'`);
  }
}

export function assertNotExpired(expiry: string): void {
  if (new Date(expiry) < new Date()) {
    throw new DomainError("CONTRACT_EXPIRED", `contract expired on ${expiry}`);
  }
}

export type MilestonePenaltyInput = {
  amountMinor: bigint;
  dueDate: string;
  achievedDate: string;
  /** Percent of milestone amount charged per full/partial week of delay. */
  penaltyRatePct: number;
  /** Cap on total penalty as percent of milestone amount. */
  maxPenaltyPct: number;
};

export type MilestonePenaltyResult = {
  delayDays: number;
  delayWeeks: number;
  isLate: boolean;
  status: "completed" | "completed_late";
  cappedPenaltyPct: number;
  rawPenaltyPct: number;
  penaltyMinor: bigint;
  netPayableMinor: bigint;
};

function parseDateOnly(value: string): Date {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    throw new DomainError("INVALID_DATE", `date must be YYYY-MM-DD, got '${value}'`);
  }
  const d = new Date(`${value}T00:00:00.000Z`);
  if (Number.isNaN(d.getTime())) {
    throw new DomainError("INVALID_DATE", `invalid calendar date '${value}'`);
  }
  return d;
}

/**
 * Compute SLA delay penalty in paise (bigint). Uses basis-points internally so
 * fractional percent rates (e.g. 0.5%/week) do not rely on IEEE floats for money.
 */
export function computeMilestonePenalty(input: MilestonePenaltyInput): MilestonePenaltyResult {
  if (input.amountMinor < 0n) {
    throw new DomainError("INVALID_AMOUNT", "milestone amountMinor must be non-negative");
  }
  if (!(input.penaltyRatePct >= 0) || !(input.maxPenaltyPct >= 0)) {
    throw new DomainError("INVALID_SLA", "penalty rates must be non-negative");
  }

  const due = parseDateOnly(input.dueDate);
  const achieved = parseDateOnly(input.achievedDate);
  const delayMs = achieved.getTime() - due.getTime();
  const delayDays = Math.max(0, Math.ceil(delayMs / 86_400_000));
  const delayWeeks = delayDays === 0 ? 0 : Math.ceil(delayDays / 7);
  const isLate = delayDays > 0;

  const rateBp = Math.round(input.penaltyRatePct * 100); // 0.5% -> 50 bp
  const maxBp = Math.round(input.maxPenaltyPct * 100);
  const rawBp = delayWeeks * rateBp;
  const cappedBp = Math.min(rawBp, maxBp);
  const penaltyMinor = (input.amountMinor * BigInt(cappedBp)) / 10_000n;
  const netPayableMinor = input.amountMinor > penaltyMinor ? input.amountMinor - penaltyMinor : 0n;

  return {
    delayDays,
    delayWeeks,
    isLate,
    status: isLate ? "completed_late" : "completed",
    rawPenaltyPct: Number((rawBp / 100).toFixed(2)),
    cappedPenaltyPct: Number((cappedBp / 100).toFixed(2)),
    penaltyMinor,
    netPayableMinor,
  };
}

export type BondStatus = "held" | "released" | "claimed" | "forfeited";

const BOND_TRANSITIONS: Record<BondStatus, BondStatus[]> = {
  held:      ["released", "claimed", "forfeited"],
  released:  [],
  claimed:   [],
  forfeited: [],
};

export function assertBondTransition(from: string, to: BondStatus): void {
  const allowed = BOND_TRANSITIONS[from as BondStatus] ?? [];
  if (!allowed.includes(to)) {
    throw new DomainError("INVALID_BOND_TRANSITION", `performance bond cannot transition from '${from}' to '${to}'`);
  }
}
