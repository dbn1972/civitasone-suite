/**
 * feasibility.ts — the single, shared definition of the STRUCTURAL hard
 * constraints (spec §7.1), derived from the frozen snapshot.
 *
 * This is deliberately the ONE place that decides whether an (employee, position)
 * pair is hard-feasible, so that the solver and the independent validator cannot
 * drift apart on the definition of "hard violation". The validator re-derives the
 * same predicates independently (it does not trust the solver's output flags).
 */

import type {
  AllocationSnapshot,
  HardConstraint,
  HardConstraintKind,
  SnapshotEmployee,
  SnapshotPosition,
} from "./SolverPort.js";

/** Returns the hard-constraint kinds VIOLATED by posting `e` into `p`. Empty = feasible. */
export function hardViolations(
  e: SnapshotEmployee,
  p: SnapshotPosition,
  declared: readonly HardConstraint[],
): HardConstraintKind[] {
  const v: HardConstraintKind[] = [];

  // eligibility / legal hold: a held employee cannot be moved at all.
  if (e.hold) v.push("legalHold");

  // cadre + grade compatibility.
  if (e.cadre !== p.cadre || e.grade !== p.grade) v.push("cadreGradeCompatibility");

  // qualification / specialisation: employee must hold every required qual.
  if (!p.requiredQualifications.every((q) => e.qualifications.includes(q))) {
    v.push("qualificationSpecialisation");
  }

  // jurisdiction / authority: employee must be within the post's jurisdiction.
  if (e.jurisdictionUnitId !== p.jurisdictionUnitId) v.push("jurisdictionAuthority");

  // sensitive-post restriction: declared per-position sensitive locks.
  if (p.sensitive) {
    const locked = declared.some(
      (c) => c.kind === "sensitivePostRestriction" && c.positionId === p.id,
    );
    if (locked) v.push("sensitivePostRestriction");
  }

  // location restriction: a declared employee↔location prohibition.
  for (const c of declared) {
    if (c.kind === "locationRestriction" && c.employeeId === e.id) {
      const forbidden = (c.params?.["forbiddenLocationClasses"] as string[] | undefined) ?? [];
      if (forbidden.includes(p.locationClass)) {
        v.push("locationRestriction");
        break;
      }
    }
  }

  return dedupe(v);
}

/** True iff posting e into p violates no hard constraint. */
export function isHardFeasible(
  e: SnapshotEmployee,
  p: SnapshotPosition,
  declared: readonly HardConstraint[],
): boolean {
  return hardViolations(e, p, declared).length === 0;
}

/**
 * A reusable index of positions bucketed by (cadre:jurisdiction) — the two
 * always-hard dimensions. Scanning only the employee's own bucket makes
 * minimal-blocking derivation O(bucket) instead of O(all positions), which is
 * what keeps the 100k validation tractable. Building it is O(P).
 */
export interface PositionIndex {
  readonly byCadreJurisdiction: Map<string, SnapshotPosition[]>;
  readonly all: readonly SnapshotPosition[];
}

export function buildPositionIndex(snapshot: AllocationSnapshot): PositionIndex {
  const byCadreJurisdiction = new Map<string, SnapshotPosition[]>();
  for (const p of snapshot.positions) {
    const k = `${p.cadre}:${p.jurisdictionUnitId}`;
    (byCadreJurisdiction.get(k) ?? byCadreJurisdiction.set(k, []).get(k)!).push(p);
  }
  return { byCadreJurisdiction, all: snapshot.positions };
}

/**
 * Minimal blocking constraints for an unassigned employee: the smallest set of
 * hard-constraint kinds such that relaxing all of them makes at least one post
 * feasible. We return the globally minimum-size violation set, which is minimal
 * in the sense required by D-ST-05(4): every listed kind must be relaxed for some
 * post to open.
 *
 * Determinism: among equal-size candidate sets the result is the lexicographically
 * smallest sorted set, so the output is independent of position scan order (and
 * therefore independent of the fast-path vs full-scan traversal).
 *
 * Exact fast path: because `cadreGradeCompatibility` (via cadre) and
 * `jurisdictionAuthority` are hard, any position OUTSIDE the employee's
 * (cadre:jurisdiction) bucket necessarily violates at least one of those two.
 * The global minimum is thus the better of (a) the minimum over the employee's
 * own bucket and (b) the minimum over buckets differing in exactly one hard
 * dimension; buckets differing in both can never beat those. We never scan more
 * than those buckets, which keeps 100k validation tractable.
 */
export function minimalBlockingConstraints(
  e: SnapshotEmployee,
  snapshot: AllocationSnapshot,
  index?: PositionIndex,
): HardConstraintKind[] {
  const idx = index ?? buildPositionIndex(snapshot);
  const bucketKey = `${e.cadre}:${e.jurisdictionUnitId}`;

  let best: HardConstraintKind[] | null = null;
  const consider = (positions: readonly SnapshotPosition[]): boolean => {
    for (const p of positions) {
      const v = sortViol(hardViolations(e, p, snapshot.hardConstraints));
      if (v.length === 0) {
        best = [];
        return true; // feasible post exists → nothing blocks; stop.
      }
      if (best === null || betterSet(v, best)) best = v;
    }
    return false;
  };

  // (a) own bucket.
  if (consider(idx.byCadreJurisdiction.get(bucketKey) ?? [])) return [];

  // (b) buckets differing in exactly one hard dimension.
  for (const [k, positions] of idx.byCadreJurisdiction) {
    if (k === bucketKey) continue;
    const [cadre, jur] = k.split(":");
    const diffCount = (cadre !== e.cadre ? 1 : 0) + (jur !== e.jurisdictionUnitId ? 1 : 0);
    if (diffCount !== 1) continue;
    if (consider(positions)) return [];
  }

  return best ?? [];
}

/** True iff candidate set `a` is strictly preferred over `b`: fewer kinds, then lexicographically smaller. */
function betterSet(a: HardConstraintKind[], b: HardConstraintKind[]): boolean {
  if (a.length !== b.length) return a.length < b.length;
  for (let i = 0; i < a.length; i++) {
    if (a[i]! !== b[i]!) return a[i]! < b[i]!;
  }
  return false;
}

function sortViol(xs: HardConstraintKind[]): HardConstraintKind[] {
  return [...xs].sort();
}

function dedupe(xs: HardConstraintKind[]): HardConstraintKind[] {
  return [...new Set(xs)];
}
