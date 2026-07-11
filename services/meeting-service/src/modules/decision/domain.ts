/**
 * decision module — pure domain logic (no I/O, no side effects, fully unit/property testable).
 *
 * Single source of truth for how the service records decisions and resolutions:
 *
 *   - Resolution numbering: sequential per committee per financial year (Req 11.4, P25) —
 *     `nextResolutionSequence` + `generateResolutionNumber` (financial year reused from
 *     meeting-core so both numbering schemes agree on the April–March boundary).
 *   - Vote-result computation per configured majority rule (Req 11.3, P16) —
 *     `computeVoteResult` (simple_majority / two_thirds / three_fourths / unanimous), using
 *     exact integer cross-multiplication (no floating point) so the boundary cases are precise.
 *   - Circulation-resolution validity (Req 12.2, 12.5, P18) — `requiredResponseCount`,
 *     `circulationResponseRate`, `computeCirculationResult`: a circulation resolution is valid
 *     only when the response rate meets the configured minimum, otherwise its result is `invalid`.
 *   - Supersede / lineage logic with acyclicity (Req 11.8, 17.4) — `assertAcyclicLineage`,
 *     `wouldCreateCycle`, `buildSupersedePlan`.
 *   - Typed ERP-event routing (Req 22.1–22.5) — `routeDecisionEvents` maps a decision `type`
 *     to the downstream event topics (procurement / financial / hr / project / legal) alongside
 *     the generic `decision.recorded` fact.
 *
 * Domain-rule violations are raised as the service's typed `HttpError` (via `httpError`) so the
 * standard error envelope + HTTP status contract is preserved end-to-end. These functions remain
 * pure and deterministic given their inputs.
 *
 * _Requirements: 11.1, 11.2, 11.3, 11.4, 11.5, 11.6, 11.7, 11.8, 12.1, 12.2, 12.3, 12.4, 12.5, 12.6, 12.7_
 */
import { httpError } from "../../shared/context.js";
import { computeFinancialYear } from "../meeting-core/domain.js";
import { EVENTS } from "../../topics.js";

// ─── Domain vocabularies (mirror the migration value sets) ────────────────────

/**
 * Decision classification (Req 22.x). The ERP-routable subset (procurement / financial / hr /
 * project / legal) drives typed downstream events; the remaining generic types produce only the
 * generic `decision.recorded` fact.
 */
export const DECISION_TYPES = [
  "administrative",
  "policy",
  "procurement",
  "financial",
  "hr",
  "project",
  "legal",
  "general",
] as const;
export type DecisionType = (typeof DECISION_TYPES)[number];

/** Decision lifecycle / register status (Req 11.8: effective, superseded, withdrawn). */
export const DECISION_STATUSES = ["effective", "superseded", "withdrawn"] as const;
export type DecisionStatus = (typeof DECISION_STATUSES)[number];

/** Resolution register status (Req 11.8). */
export const RESOLUTION_STATUSES = ["effective", "superseded", "withdrawn"] as const;
export type ResolutionStatus = (typeof RESOLUTION_STATUSES)[number];

/** Voting types (Req 11.1). */
export const VOTE_TYPES = [
  "show_of_hands",
  "roll_call",
  "secret_ballot",
  "electronic_poll",
  "circulation_resolution",
] as const;
export type VoteType = (typeof VOTE_TYPES)[number];

/** Configurable majority rules (Req 11.3, P16). */
export const MAJORITY_RULES = ["simple_majority", "two_thirds", "three_fourths", "unanimous"] as const;
export type MajorityRule = (typeof MAJORITY_RULES)[number];

/** Computed resolution outcomes. `invalid` is reserved for failed circulation resolutions (P18). */
export const RESOLUTION_RESULTS = ["passed", "rejected", "invalid"] as const;
export type ResolutionResult = (typeof RESOLUTION_RESULTS)[number];

/** In-meeting vote positions (Req 11.3). */
export const VOTE_POSITIONS = ["for", "against", "abstain"] as const;
export type VotePosition = (typeof VOTE_POSITIONS)[number];

/** Circulation-resolution response positions (Req 12.3). */
export const CIRCULATION_POSITIONS = ["approve", "reject", "abstain"] as const;
export type CirculationPosition = (typeof CIRCULATION_POSITIONS)[number];

/** Decision-lineage relation kinds (Req 17.4: decision register lineage). */
export const LINEAGE_RELATIONS = ["supersedes", "amends", "implements", "reverses"] as const;
export type LineageRelation = (typeof LINEAGE_RELATIONS)[number];

// ─── Resolution numbering (Req 11.4 · P25) ─────────────────────────────────────

/** Re-exported so callers can derive the FY scope for resolution numbering consistently. */
export { computeFinancialYear };

/**
 * The financial year label for a resolution, derived from its effective/meeting date. Thin
 * wrapper over meeting-core `computeFinancialYear` so meeting numbers and resolution numbers
 * share one April–March boundary definition (canonical `YYYY-YY`, e.g. `"2025-26"`).
 */
export function resolutionFinancialYear(d: Date): string {
  return computeFinancialYear(d);
}

/**
 * Next resolution sequence for a committee within a financial year, given the sequences already
 * issued for that (committee, FY) scope. Sequential and gap-tolerant: returns `max + 1`, or `1`
 * when none exist. Callers pass the existing sequences read from the DB under the same scope;
 * the DB UNIQUE constraint is the ultimate guard against races (P25).
 */
export function nextResolutionSequence(existingSequences: readonly number[]): number {
  let max = 0;
  for (const s of existingSequences) {
    if (Number.isFinite(s) && s > max) max = Math.trunc(s);
  }
  return max + 1;
}

/**
 * Format a sequential resolution number scoped to a committee + financial year (Req 11.4), e.g.
 * `{ committeeCode: "FC", financialYear: "2025-26", sequence: 7 }` → `"FC/RES/2025-26/007"`.
 * Falls back to the `"RES"` prefix when no committee code is available. The `RES` segment
 * distinguishes resolution numbers from meeting numbers that share the committee/FY scope.
 */
export function generateResolutionNumber(input: {
  committeeCode?: string | null;
  financialYear: string;
  sequence: number;
}): string {
  const code = (input.committeeCode ?? "").trim().toUpperCase() || "RES";
  const seq = String(Math.max(1, Math.trunc(input.sequence))).padStart(3, "0");
  return `${code}/RES/${input.financialYear}/${seq}`;
}

// ─── Vote tally + majority rule computation (Req 11.3 · P16) ───────────────────

/** A tally of votes on a resolution. Counts are non-negative integers. */
export interface VoteTally {
  votesFor: number;
  votesAgainst: number;
  votesAbstain: number;
}

/** Total ballots cast (for + against + abstain). Used by P14-style consistency checks. */
export function totalVotes(tally: VoteTally): number {
  return normalizeCount(tally.votesFor) + normalizeCount(tally.votesAgainst) + normalizeCount(tally.votesAbstain);
}

function normalizeCount(n: number): number {
  return Number.isFinite(n) && n > 0 ? Math.trunc(n) : 0;
}

/**
 * Compute a resolution's outcome (`passed` | `rejected`) from its vote tally under a majority
 * rule (Req 11.3, P16). Abstentions are recorded but do NOT count toward the majority base —
 * the base is the decisive votes (for + against). Comparisons use exact integer cross-
 * multiplication so the two-thirds / three-fourths boundaries are precise (no floating point):
 *
 *   simple_majority — for > against (strictly more decisive votes in favour)
 *   two_thirds      — for * 3 >= (for + against) * 2   (>= 66.67% of decisive votes)
 *   three_fourths   — for * 4 >= (for + against) * 3   (>= 75% of decisive votes)
 *   unanimous       — for > 0 AND against == 0 AND abstain == 0   (every ballot in favour)
 *
 * With no decisive votes cast the resolution is `rejected` for every rule (a resolution never
 * passes on zero support).
 */
export function computeVoteResult(
  tally: VoteTally,
  majorityRule: MajorityRule,
): Extract<ResolutionResult, "passed" | "rejected"> {
  const votesFor = normalizeCount(tally.votesFor);
  const votesAgainst = normalizeCount(tally.votesAgainst);
  const votesAbstain = normalizeCount(tally.votesAbstain);
  const decisive = votesFor + votesAgainst;

  let passed: boolean;
  switch (majorityRule) {
    case "simple_majority":
      passed = votesFor > votesAgainst;
      break;
    case "two_thirds":
      passed = decisive > 0 && votesFor * 3 >= decisive * 2;
      break;
    case "three_fourths":
      passed = decisive > 0 && votesFor * 4 >= decisive * 3;
      break;
    case "unanimous":
      passed = votesFor > 0 && votesAgainst === 0 && votesAbstain === 0;
      break;
    default:
      // Exhaustiveness guard: an unknown rule is a programmer/config error, not a silent pass.
      throw httpError("VALIDATION_FAILED", `unknown majority rule "${String(majorityRule)}"`, { majorityRule });
  }
  return passed ? "passed" : "rejected";
}

// ─── Circulation resolution validity (Req 12.2, 12.5 · P18) ────────────────────

/** Tenant/committee-configurable circulation knobs. Absent fields fall back to two-thirds. */
export interface CirculationConfig {
  /**
   * Minimum share of members that must respond for the circulation to be valid, expressed as a
   * percentage (0–100). Defaults to two-thirds (`DEFAULT_CIRCULATION_MIN_RESPONSE_RATE_PCT`).
   */
  minResponseRatePct?: number;
}

/** Default minimum response rate: two-thirds of members (Req 12.2). Kept exact as 200/3 %. */
export const DEFAULT_CIRCULATION_MIN_RESPONSE_RATE_PCT = 200 / 3;

function resolveMinResponseRatePct(config?: CirculationConfig): number {
  const p = config?.minResponseRatePct;
  return typeof p === "number" && Number.isFinite(p) && p >= 0 && p <= 100
    ? p
    : DEFAULT_CIRCULATION_MIN_RESPONSE_RATE_PCT;
}

/**
 * Minimum number of member responses required for a circulation to be valid, for a committee of
 * `totalMembers` (Req 12.2). Computed as `ceil(totalMembers * minRatePct / 100)` so the default
 * two-thirds rule is satisfied exactly (e.g. 3 members → 2, 6 members → 4). A committee with no
 * members requires 0 responses (there is nobody to respond).
 */
export function requiredResponseCount(totalMembers: number, config?: CirculationConfig): number {
  const members = normalizeCount(totalMembers);
  if (members === 0) return 0;
  const pct = resolveMinResponseRatePct(config);
  return Math.ceil((members * pct) / 100);
}

/**
 * Achieved response rate as an integer percentage (0–100) for storage in
 * `resolutions.response_rate` and the circulation-status view. Rounded to the nearest percent;
 * a committee with no members reports 0.
 */
export function circulationResponseRate(respondedCount: number, totalMembers: number): number {
  const members = normalizeCount(totalMembers);
  if (members === 0) return 0;
  const responded = Math.min(normalizeCount(respondedCount), members);
  return Math.round((responded * 100) / members);
}

/**
 * True when enough members responded for the circulation to be valid (Req 12.2, P18): the
 * responded count meets `requiredResponseCount`. Uses exact integer comparison against the
 * derived required count rather than comparing rounded percentages.
 */
export function isCirculationResponseSufficient(
  respondedCount: number,
  totalMembers: number,
  config?: CirculationConfig,
): boolean {
  const members = normalizeCount(totalMembers);
  if (members === 0) return false;
  return normalizeCount(respondedCount) >= requiredResponseCount(members, config);
}

/** Outcome of a completed circulation resolution. */
export interface CirculationOutcome {
  /** Whether the response threshold was met (Req 12.2). */
  valid: boolean;
  /** Achieved response rate as an integer percentage (stored in `response_rate`). */
  responseRate: number;
  /** `invalid` when the threshold is not met (P18); otherwise the majority-rule outcome. */
  result: ResolutionResult;
}

/**
 * Compute the final outcome of a circulation resolution once the deadline passes or all members
 * have responded (Req 12.4). If the response threshold is not met the result is `invalid`
 * (P18, Req 12.5); otherwise the approve/reject/abstain tally is decided under the configured
 * majority rule (approve→for, reject→against, abstain→abstain).
 */
export function computeCirculationResult(input: {
  approveCount: number;
  rejectCount: number;
  abstainCount: number;
  totalMembers: number;
  majorityRule: MajorityRule;
  config?: CirculationConfig;
}): CirculationOutcome {
  const approve = normalizeCount(input.approveCount);
  const reject = normalizeCount(input.rejectCount);
  const abstain = normalizeCount(input.abstainCount);
  const responded = approve + reject + abstain;

  const responseRate = circulationResponseRate(responded, input.totalMembers);
  const valid = isCirculationResponseSufficient(responded, input.totalMembers, input.config);

  if (!valid) {
    return { valid: false, responseRate, result: "invalid" };
  }
  const result = computeVoteResult(
    { votesFor: approve, votesAgainst: reject, votesAbstain: abstain },
    input.majorityRule,
  );
  return { valid: true, responseRate, result };
}

/**
 * Assert a circulation resolution reached a valid response rate (Req 12.5). Throws
 * `RESOLUTION_CIRCULATION_INVALID` (422) with the achieved vs required detail when insufficient —
 * the consumer uses this to record the resolution as `invalid` and notify the secretary.
 */
export function assertCirculationValid(input: {
  respondedCount: number;
  totalMembers: number;
  config?: CirculationConfig;
}): void {
  if (!isCirculationResponseSufficient(input.respondedCount, input.totalMembers, input.config)) {
    throw httpError("RESOLUTION_CIRCULATION_INVALID", "circulation resolution did not meet the required response rate", {
      respondedCount: normalizeCount(input.respondedCount),
      totalMembers: normalizeCount(input.totalMembers),
      requiredCount: requiredResponseCount(input.totalMembers, input.config),
      responseRate: circulationResponseRate(input.respondedCount, input.totalMembers),
    });
  }
}

// ─── Supersede / lineage logic with acyclicity (Req 11.8 · 17.4) ───────────────

/** A directed decision-lineage edge: `from` relates to `to` (e.g. from supersedes to). */
export interface LineageEdge {
  from: string;
  to: string;
  relation?: LineageRelation;
}

/**
 * Detect whether the directed lineage graph contains a cycle. Pure DFS with a recursion stack;
 * self-loops (`from === to`) count as a cycle. Used to keep the decision register's
 * supersedes/amends/implements/reverses graph a DAG so lineage traversal always terminates.
 */
export function hasLineageCycle(edges: readonly LineageEdge[]): boolean {
  const adjacency = new Map<string, string[]>();
  for (const e of edges) {
    if (e.from === e.to) return true; // self-loop
    const list = adjacency.get(e.from) ?? [];
    list.push(e.to);
    adjacency.set(e.from, list);
  }

  const visited = new Set<string>();
  const onStack = new Set<string>();

  const visit = (node: string): boolean => {
    visited.add(node);
    onStack.add(node);
    for (const next of adjacency.get(node) ?? []) {
      if (onStack.has(next)) return true;
      if (!visited.has(next) && visit(next)) return true;
    }
    onStack.delete(node);
    return false;
  };

  for (const node of adjacency.keys()) {
    if (!visited.has(node) && visit(node)) return true;
  }
  return false;
}

/**
 * True when adding the edge `from → to` to the existing lineage graph would introduce a cycle
 * (Req 11.8). Callers use this before recording a supersedes/amends/implements/reverses link.
 */
export function wouldCreateCycle(existing: readonly LineageEdge[], from: string, to: string): boolean {
  return hasLineageCycle([...existing, { from, to }]);
}

/**
 * Guard that a new lineage edge keeps the decision graph acyclic (Req 11.8). Throws
 * `VALIDATION_FAILED` (400) with the offending edge when the link would create a cycle.
 */
export function assertAcyclicLineage(existing: readonly LineageEdge[], edge: LineageEdge): void {
  if (edge.from === edge.to) {
    throw httpError("VALIDATION_FAILED", "a decision cannot supersede/relate to itself", {
      from: edge.from,
      to: edge.to,
    });
  }
  if (wouldCreateCycle(existing, edge.from, edge.to)) {
    throw httpError("VALIDATION_FAILED", "lineage link would create a cycle in the decision register", {
      from: edge.from,
      to: edge.to,
      relation: edge.relation ?? "supersedes",
    });
  }
}

/** A supersession plan: how to mark the superseded decision and link the superseding one. */
export interface SupersedePlan {
  /** The decision being superseded → status `superseded`, back-pointer to the new decision. */
  supersededUpdate: {
    id: string;
    status: Extract<DecisionStatus, "superseded">;
    supersededById: string;
  };
  /** The lineage edge to record (new decision `supersedes` the old one). */
  lineageEdge: LineageEdge;
}

/**
 * Build the plan to supersede `supersededId` with `supersedingId` (Req 11.8). Validates the
 * link keeps the lineage graph acyclic first (throws `VALIDATION_FAILED` otherwise). Pure — the
 * consumer persists the status update and the lineage edge in one transaction.
 */
export function buildSupersedePlan(input: {
  supersedingId: string;
  supersededId: string;
  existingLineage?: readonly LineageEdge[];
}): SupersedePlan {
  const edge: LineageEdge = { from: input.supersedingId, to: input.supersededId, relation: "supersedes" };
  assertAcyclicLineage(input.existingLineage ?? [], edge);
  return {
    supersededUpdate: {
      id: input.supersededId,
      status: "superseded",
      supersededById: input.supersedingId,
    },
    lineageEdge: edge,
  };
}

// ─── Typed ERP-event routing (Req 22.1–22.5) ───────────────────────────────────

/** Maps ERP-routable decision types to their dedicated downstream event topic. */
const DECISION_EVENT_BY_TYPE: Partial<Record<DecisionType, string>> = {
  procurement: EVENTS.decisionProcurement,
  financial: EVENTS.decisionFinancial,
  hr: EVENTS.decisionHr,
  project: EVENTS.decisionProject,
  legal: EVENTS.decisionLegal,
};

/**
 * Determine the downstream event topics to emit for a recorded decision (Req 22.1–22.5). Every
 * decision emits the generic `decision.recorded` fact (audit/analytics); ERP-routable types
 * (procurement / financial / hr / project / legal) additionally emit their dedicated typed event
 * consumed by the corresponding service. Unknown/generic types emit only the generic fact.
 *
 * Returned in a stable order: the generic fact first, then the typed event (if any).
 */
export function routeDecisionEvents(decisionType: string): string[] {
  const topics: string[] = [EVENTS.decisionRecorded];
  const typed = DECISION_EVENT_BY_TYPE[decisionType as DecisionType];
  if (typed) topics.push(typed);
  return topics;
}

/** True when a decision `type` routes to a dedicated ERP service event (vs generic only). */
export function isErpRoutableDecision(decisionType: string): boolean {
  return Boolean(DECISION_EVENT_BY_TYPE[decisionType as DecisionType]);
}
