/**
 * SolverPort — the technology-neutral port that SmartTransfer's future allocation
 * engine (spec §7) will depend on.
 *
 * SPIKE SCOPE (ST-M01-13): this interface is defined here so the spike can prove a
 * concrete TypeScript baseline (and, as a candidate, an OR-Tools CP-SAT sidecar)
 * satisfies it. It is NOT yet imported by any production service. The production
 * home for this port, if a non-Node solver is adopted (D-ST-05), is
 * `services/smarttransfer-service` (ST-M01-12), not `spikes/`.
 *
 * Design intent (binding on any future production port, informed by spec §7 and
 * D-ST-05):
 *   - The solver receives a FROZEN, immutable snapshot (spec §7.3). It never reads
 *     or writes HRMS/Workforce Core (D-ST-10): the caller freezes the snapshot and
 *     stores the authorised result.
 *   - Hard constraints are inviolable (principle P06): a committed assignment never
 *     violates a hard constraint. Soft objectives only influence the score.
 *   - Evaluation is pure w.r.t. (snapshot, seed): identical inputs on an identical
 *     snapshot and seed yield an identical plan AND an identical planHash. This is
 *     the deterministic-replay contract the engine's evidence (spec §7.3) relies
 *     on, with deterministic tie-breaking throughout.
 *   - Every unassigned employee carries the MINIMAL set of blocking hard
 *     constraints (infeasibility diagnosis, spec §7.2).
 */

/** Stable identifiers. Spike uses opaque strings; production maps to UUIDs. */
export type EmployeeId = string;
export type PositionId = string;

/** The hard-constraint catalogue (spec §7.1). Spike models the structural ones. */
export type HardConstraintKind =
  | "eligibility"
  | "cadreGradeCompatibility"
  | "qualificationSpecialisation"
  | "jurisdictionAuthority"
  | "sanctionedCapacity"
  | "vacancyOccupancy"
  | "locationRestriction"
  | "minimumStaffing"
  | "mandatoryTenure"
  | "legalHold"
  | "sensitivePostRestriction"
  | "crossCycleConflict"
  | "transferChainDependency";

/** The soft-objective catalogue (spec §7.1). Spike models a representative set. */
export type SoftObjectiveKind =
  | "preference"
  | "hardshipPriority"
  | "tenureFairness"
  | "staffingBalance"
  | "minimumDisruption"
  | "criticalVacancyCoverage"
  | "organisationalPriority";

/** An employee in the frozen snapshot. Synthetic only — never real PII. */
export interface SnapshotEmployee {
  readonly id: EmployeeId;
  readonly cadre: string;
  readonly grade: number;
  /** Qualifications/specialisations the employee holds. */
  readonly qualifications: readonly string[];
  /** Jurisdiction units the employee may be posted within. */
  readonly jurisdictionUnitId: string;
  /** The employee's current substantive position (origin of the move). */
  readonly currentPositionId: PositionId | null;
  /** Months in the current post; feeds mandatory-tenure + tenure-fairness. */
  readonly tenureMonths: number;
  /** Legal hold flags (court stay, vigilance, enquiry). A set hold blocks moves. */
  readonly hold: boolean;
  /** Approved hardship priority (0 = none; higher = stronger). Soft only. */
  readonly hardshipPriority: number;
  /** Whether the employee may remain unassigned without a hard violation. */
  readonly mayRemainUnassigned: boolean;
}

/** A sanctioned position/vacancy in the frozen snapshot. */
export interface SnapshotPosition {
  readonly id: PositionId;
  readonly cadre: string;
  readonly grade: number;
  /** Qualifications/specialisations required to hold the post. */
  readonly requiredQualifications: readonly string[];
  readonly jurisdictionUnitId: string;
  /** Sanctioned capacity (substantive holders). Spike models one-per-post as 1. */
  readonly capacity: number;
  /** True if the post is sensitive (restricted rotation). */
  readonly sensitive: boolean;
  /** Minimum staffing the owning office must retain; feeds minimumStaffing. */
  readonly minimumStaffing: number;
  /** Location/city class, for location-restriction and disruption scoring. */
  readonly locationClass: string;
}

/**
 * A declared hard constraint instance. The structural constraints
 * (eligibility, capacity, …) are derived from the snapshot; this list carries
 * any additional pre-registered restrictions (e.g. a sensitive-post lock, a
 * named location restriction) that the policy pack imposes on top.
 */
export interface HardConstraint {
  readonly kind: HardConstraintKind;
  /** Scope: a specific employee, position, or global when both are omitted. */
  readonly employeeId?: EmployeeId;
  readonly positionId?: PositionId;
  /** Opaque parameters for the constraint (e.g. forbidden location classes). */
  readonly params?: Readonly<Record<string, unknown>>;
}

/** A declared soft objective with an APPROVED, documented weight (spec §7.1). */
export interface SoftObjective {
  readonly kind: SoftObjectiveKind;
  /** Non-negative weight. No weight may be used unless documented and approved. */
  readonly weight: number;
}

/** Ranked employee preferences over positions (soft objective input). */
export interface EmployeePreference {
  readonly employeeId: EmployeeId;
  /** positionIds in descending preference; index 0 is most preferred. */
  readonly rankedPositionIds: readonly PositionId[];
}

/** The frozen, immutable solver input (spec §7.3). */
export interface AllocationSnapshot {
  /** Content-addressed snapshot id so a run can be replayed from evidence. */
  readonly snapshotId: string;
  readonly employees: readonly SnapshotEmployee[];
  readonly positions: readonly SnapshotPosition[];
  readonly preferences: readonly EmployeePreference[];
  readonly hardConstraints: readonly HardConstraint[];
  readonly softObjectives: readonly SoftObjective[];
  /**
   * Partition key: the engine decomposes by this (e.g. cadre×jurisdiction) and
   * solves each partition independently (D-ST-05 "per 10k-employee partition").
   */
  readonly partitionOf: (employee: SnapshotEmployee) => string;
}

/** One recommended assignment in the output. */
export interface Assignment {
  readonly employeeId: EmployeeId;
  readonly positionId: PositionId;
  /** The marginal score contribution of this pairing (for audit/explanation). */
  readonly score: number;
}

/** An unassigned employee with the MINIMAL set of blocking hard constraints. */
export interface UnassignedEmployee {
  readonly employeeId: EmployeeId;
  /**
   * Minimal blocking constraints: the smallest set of hard-constraint kinds such
   * that, if all were relaxed, at least one feasible position would exist. Empty
   * only when the employee was permitted to remain unassigned (mayRemainUnassigned)
   * and no position improved the score.
   */
  readonly minimalBlockingConstraints: readonly HardConstraintKind[];
}

/** The full, replayable result of one allocation run (spec §7.3). */
export interface AllocationPlan {
  readonly snapshotId: string;
  readonly solverName: string;
  readonly solverVersion: string;
  readonly seed: number;
  readonly assignments: readonly Assignment[];
  readonly unassigned: readonly UnassignedEmployee[];
  /** Total objective value F(x) over the committed assignments (spec §7.1). */
  readonly score: number;
  /**
   * sha256 over the canonical sorted output (assignments sorted by employeeId
   * then positionId, unassigned sorted by employeeId). Byte-identical across runs
   * for the same (snapshot, seed) — the deterministic-replay contract.
   */
  readonly planHash: string;
}

/** Options for a single solve. */
export interface SolveOptions {
  readonly seed: number;
  /** Wall-clock budget per partition in milliseconds (D-ST-05 ≤ 15 min). */
  readonly timeBudgetMsPerPartition?: number;
}

/**
 * The port. A production adapter is expected to be deterministic for a fixed
 * (snapshot, seed) and to decompose large inputs by `partitionOf`.
 */
export interface SolverPort {
  readonly name: string;
  readonly version: string;
  solve(snapshot: AllocationSnapshot, options: SolveOptions): Promise<AllocationPlan>;
}

/**
 * Timefold adapter interface slot — DEFINED ONLY, NOT RUN.
 *
 * D-ST-06 (solver licensing/hosting) is PROPOSED and marked "before M01 spike".
 * Per the ST-M01-13 scope, Timefold is NOT built or run in this spike; only the
 * adapter slot is declared so the port surface is complete. The report records
 * "NOT RUN — blocked on D-ST-06".
 */
export interface TimefoldAdapterSlot extends SolverPort {
  /** @throws always, until D-ST-06 is approved and the adapter is implemented. */
  readonly blockedOn: "D-ST-06";
}
