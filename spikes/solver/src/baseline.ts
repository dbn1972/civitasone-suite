/**
 * baseline.ts — the TypeScript BASELINE solver, the DEFAULT per D-ST-05(c).
 *
 * Algorithm:
 *   1. Partition the snapshot by `partitionOf` (cadre × jurisdiction). Hard
 *      feasibility can never cross a partition boundary in the synthetic model
 *      (cadre and jurisdiction are both hard), so partitions are independent and
 *      can be solved exactly and in parallel conceptually.
 *   2. Per partition, build a bipartite graph of hard-FEASIBLE (employee,
 *      position) pairs and run an exact min-cost max-flow to get the
 *      max-total-score assignment. Scores are integers; max-weight is reduced to
 *      min-cost by negating. This guarantees ZERO hard violations and ZERO
 *      duplicate occupancy (capacity 1 per post, 1 unit of supply per employee).
 *   3. A deterministic LOCAL-SEARCH pass attempts score-improving 2-swaps that
 *      remain hard-feasible. MCMF is already optimal for the linear objective, so
 *      this pass is a no-op on it, but it is retained because production soft
 *      objectives (staffing balance) are non-linear; it only ever ACCEPTS a swap
 *      that strictly raises the integer score, so it can never introduce a
 *      violation or reduce the score.
 *   4. Unassigned employees get their MINIMAL blocking hard-constraint set
 *      (spec §7.2 infeasibility diagnosis, D-ST-05(4)).
 *
 * Determinism: inputs are processed in a stable sorted order, MCMF explores edges
 * in insertion order, and tie-breaks are by (employeeId, positionId). The
 * canonical plan hash is therefore byte-identical for a fixed (snapshot, seed).
 */

import type {
  AllocationPlan,
  AllocationSnapshot,
  Assignment,
  SnapshotEmployee,
  SnapshotPosition,
  SolveOptions,
  SolverPort,
  UnassignedEmployee,
} from "./SolverPort.js";
import { buildPositionIndex, hardViolations, isHardFeasible, minimalBlockingConstraints } from "./feasibility.js";
import { MinCostMaxFlow } from "./mcmf.js";
import { buildScoringContext, pairScore, planHash, totalScore } from "./scoring.js";

export const BASELINE_NAME = "ts-baseline-mcmf-localsearch";
export const BASELINE_VERSION = "0.1.0";

export class BaselineSolver implements SolverPort {
  readonly name = BASELINE_NAME;
  readonly version = BASELINE_VERSION;

  async solve(snapshot: AllocationSnapshot, options: SolveOptions): Promise<AllocationPlan> {
    const ctx = buildScoringContext(snapshot.softObjectives, snapshot.preferences);

    // Stable sort of employees & positions for determinism.
    const employees = [...snapshot.employees].sort(byId);
    const positions = [...snapshot.positions].sort(byId);

    // Group by partition key.
    const partEmp = new Map<string, SnapshotEmployee[]>();
    for (const e of employees) {
      const k = snapshot.partitionOf(e);
      (partEmp.get(k) ?? partEmp.set(k, []).get(k)!).push(e);
    }
    const partPos = new Map<string, SnapshotPosition[]>();
    for (const p of positions) {
      // A position's partition is its (cadre, jurisdiction) — the key an employee
      // feasible for it would carry.
      const k = `${p.cadre}:${p.jurisdictionUnitId}`;
      (partPos.get(k) ?? partPos.set(k, []).get(k)!).push(p);
    }

    const assignments: Assignment[] = [];
    const assignedEmployees = new Set<string>();

    for (const [key, emps] of [...partEmp.entries()].sort((a, b) => cmp(a[0], b[0]))) {
      const posns = partPos.get(key) ?? [];
      if (posns.length === 0) continue; // nobody can be placed in this partition.
      solvePartition(emps, posns, snapshot, ctx, assignments, assignedEmployees);
    }

    // Local-search pass (strict-improvement swaps only). No-op on the linear
    // objective but kept for the non-linear production case.
    localSearch(assignments, snapshot, ctx);

    assignments.sort((a, b) =>
      a.employeeId < b.employeeId
        ? -1
        : a.employeeId > b.employeeId
          ? 1
          : cmp(a.positionId, b.positionId),
    );

    // Unassigned diagnosis.
    const posIndex = buildPositionIndex(snapshot);
    const unassigned: UnassignedEmployee[] = [];
    for (const e of employees) {
      if (assignedEmployees.has(e.id)) continue;
      unassigned.push({
        employeeId: e.id,
        minimalBlockingConstraints: minimalBlockingConstraints(e, snapshot, posIndex),
      });
    }
    unassigned.sort((a, b) => cmp(a.employeeId, b.employeeId));

    const score = totalScore(assignments);
    const hash = planHash(snapshot.snapshotId, options.seed, assignments, unassigned, score);

    return {
      snapshotId: snapshot.snapshotId,
      solverName: this.name,
      solverVersion: this.version,
      seed: options.seed,
      assignments,
      unassigned,
      score,
      planHash: hash,
    };
  }
}

function solvePartition(
  emps: SnapshotEmployee[],
  posns: SnapshotPosition[],
  snapshot: AllocationSnapshot,
  ctx: ReturnType<typeof buildScoringContext>,
  outAssignments: Assignment[],
  assignedEmployees: Set<string>,
): void {
  // Node layout: 0 = source, 1..E = employees, E+1..E+P = positions, last = sink.
  const E = emps.length;
  const P = posns.length;
  const S = 0;
  const T = E + P + 1;
  const empNode = (i: number) => 1 + i;
  const posNode = (j: number) => 1 + E + j;

  const mcmf = new MinCostMaxFlow(E + P + 2);

  // Precompute per-pair scores for feasible pairs; remember them for extraction.
  // pairScore is non-negative; we also add a tiny deterministic tie-break on
  // (employeeIndex, positionIndex) scaled below the smallest score unit so the
  // optimum is unique and replayable.
  const pairMeta = new Map<string, number>(); // "i:j" -> integer score

  for (let i = 0; i < E; i++) {
    mcmf.addEdge(S, empNode(i), 1, 0);
  }
  for (let j = 0; j < P; j++) {
    mcmf.addEdge(posNode(j), T, posns[j]!.capacity, 0);
  }
  for (let i = 0; i < E; i++) {
    const e = emps[i]!;
    for (let j = 0; j < P; j++) {
      const p = posns[j]!;
      if (!isHardFeasible(e, p, snapshot.hardConstraints)) continue;
      const base = pairScore(e, p, ctx);
      // Scale score by a factor and subtract a strictly-ordered tie-break so a
      // better score always dominates, and equal scores resolve deterministically
      // by lower (i, j). Negate for min-cost.
      const scaled = base * (E * P + 1) - (i * P + j);
      pairMeta.set(`${i}:${j}`, base);
      mcmf.addEdge(empNode(i), posNode(j), 1, -scaled);
    }
  }

  mcmf.run(S, T);

  for (const fe of mcmf.flowEdges()) {
    // employee->position carrying flow: fe.u in [1,E], fe.v in [E+1,E+P].
    if (fe.u >= 1 && fe.u <= E && fe.v >= E + 1 && fe.v <= E + P) {
      const i = fe.u - 1;
      const j = fe.v - 1 - E;
      const e = emps[i]!;
      const p = posns[j]!;
      const sc = pairMeta.get(`${i}:${j}`) ?? pairScore(e, p, ctx);
      outAssignments.push({ employeeId: e.id, positionId: p.id, score: sc });
      assignedEmployees.add(e.id);
    }
  }
}

/**
 * Deterministic strict-improvement 2-swap local search. Considers assignment
 * pairs iff both resulting pairings are hard-feasible AND the total integer score
 * strictly increases. Bounded passes.
 *
 * Scoped PER PARTITION: a swap between two employees in different
 * (cadre:jurisdiction) partitions always violates a hard constraint (different
 * cadre or jurisdiction), so it would always be rejected. Restricting the swap
 * search to within-partition pairs is therefore behaviour-preserving and turns
 * an O(assignments²) pass into O(Σ partition²), which keeps the 100k case
 * tractable without changing any result (identical plan hash).
 */
function localSearch(
  assignments: Assignment[],
  snapshot: AllocationSnapshot,
  ctx: ReturnType<typeof buildScoringContext>,
): void {
  const empById = new Map(snapshot.employees.map((e) => [e.id, e]));
  const posById = new Map(snapshot.positions.map((p) => [p.id, p]));

  // Group assignment indices by the employee's partition key.
  const groups = new Map<string, number[]>();
  for (let i = 0; i < assignments.length; i++) {
    const e = empById.get(assignments[i]!.employeeId)!;
    const k = snapshot.partitionOf(e);
    (groups.get(k) ?? groups.set(k, []).get(k)!).push(i);
  }

  const MAX_PASSES = 2;
  for (let pass = 0; pass < MAX_PASSES; pass++) {
    let improved = false;
    for (const idxs of groups.values()) {
      for (let x = 0; x < idxs.length; x++) {
        for (let y = x + 1; y < idxs.length; y++) {
          const a = idxs[x]!;
          const b = idxs[y]!;
          const A = assignments[a]!;
          const B = assignments[b]!;
          const ea = empById.get(A.employeeId)!;
          const eb = empById.get(B.employeeId)!;
          const pa = posById.get(A.positionId)!;
          const pb = posById.get(B.positionId)!;
          if (
            hardViolations(ea, pb, snapshot.hardConstraints).length > 0 ||
            hardViolations(eb, pa, snapshot.hardConstraints).length > 0
          ) {
            continue;
          }
          const before = A.score + B.score;
          const sa = pairScore(ea, pb, ctx);
          const sb = pairScore(eb, pa, ctx);
          if (sa + sb > before) {
            assignments[a] = { employeeId: ea.id, positionId: pb.id, score: sa };
            assignments[b] = { employeeId: eb.id, positionId: pa.id, score: sb };
            improved = true;
          }
        }
      }
    }
    if (!improved) break;
  }
}

function byId(a: { id: string }, b: { id: string }): number {
  return cmp(a.id, b.id);
}
function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
