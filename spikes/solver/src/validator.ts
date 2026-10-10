/**
 * validator.ts — an INDEPENDENT validator (spec §7.3 "verification results",
 * §16 always-on properties). It does not trust the solver: it re-derives hard
 * feasibility from the frozen snapshot, re-counts occupancy, recomputes the plan
 * hash, and re-derives the minimal blocking constraints for every unassigned
 * employee. A plan is VALID only if all checks pass.
 */

import type { AllocationPlan, AllocationSnapshot } from "./SolverPort.js";
import { buildPositionIndex, hardViolations, minimalBlockingConstraints } from "./feasibility.js";
import { rehash, totalScore } from "./scoring.js";

export interface ValidationIssue {
  readonly check: string;
  readonly detail: string;
}

export interface ValidationResult {
  readonly valid: boolean;
  readonly hardViolationCount: number;
  readonly duplicateOccupancyCount: number;
  readonly unknownEmployeeOrPosition: number;
  readonly planHashMatches: boolean;
  readonly scoreMatches: boolean;
  readonly blockingConstraintsValid: boolean;
  readonly issues: ValidationIssue[];
}

export function validate(snapshot: AllocationSnapshot, plan: AllocationPlan): ValidationResult {
  const issues: ValidationIssue[] = [];
  const empById = new Map(snapshot.employees.map((e) => [e.id, e]));
  const posById = new Map(snapshot.positions.map((p) => [p.id, p]));

  // 1. Zero hard violations in every committed assignment (P06).
  let hardViolationCount = 0;
  let unknown = 0;
  for (const a of plan.assignments) {
    const e = empById.get(a.employeeId);
    const p = posById.get(a.positionId);
    if (!e || !p) {
      unknown++;
      issues.push({
        check: "referential",
        detail: `assignment references unknown ${!e ? "employee " + a.employeeId : ""}${!p ? "position " + a.positionId : ""}`,
      });
      continue;
    }
    const v = hardViolations(e, p, snapshot.hardConstraints);
    if (v.length > 0) {
      hardViolationCount++;
      issues.push({
        check: "hardConstraint",
        detail: `${a.employeeId}→${a.positionId} violates [${v.join(",")}]`,
      });
    }
  }

  // 2. Zero duplicate occupancy: no post over capacity, no employee twice.
  let duplicateOccupancyCount = 0;
  const perPosition = new Map<string, number>();
  const seenEmployee = new Set<string>();
  for (const a of plan.assignments) {
    perPosition.set(a.positionId, (perPosition.get(a.positionId) ?? 0) + 1);
    if (seenEmployee.has(a.employeeId)) {
      duplicateOccupancyCount++;
      issues.push({ check: "duplicateEmployee", detail: `employee ${a.employeeId} assigned twice` });
    }
    seenEmployee.add(a.employeeId);
  }
  for (const [pid, count] of perPosition) {
    const cap = posById.get(pid)?.capacity ?? 0;
    if (count > cap) {
      duplicateOccupancyCount++;
      issues.push({
        check: "overCapacity",
        detail: `position ${pid} has ${count} holders > capacity ${cap}`,
      });
    }
  }

  // 3. Plan hash recomputation (deterministic-replay anchor).
  const recomputed = rehash(plan);
  const planHashMatches = recomputed === plan.planHash;
  if (!planHashMatches) {
    issues.push({
      check: "planHash",
      detail: `declared ${plan.planHash.slice(0, 12)} != recomputed ${recomputed.slice(0, 12)}`,
    });
  }

  // 4. Score recomputation.
  const recomputedScore = totalScore(plan.assignments);
  const scoreMatches = recomputedScore === plan.score;
  if (!scoreMatches) {
    issues.push({
      check: "score",
      detail: `declared ${plan.score} != recomputed ${recomputedScore}`,
    });
  }

  // 5. Minimal blocking constraints for every unassigned employee (D-ST-05(4)).
  //    An employee is validly unassigned iff either (a) they truly have no
  //    feasible post and the declared minimal set matches our independent
  //    derivation, or (b) they were assignable but legitimately left out because
  //    no post improved the plan AND they were permitted to remain unassigned.
  let blockingConstraintsValid = true;
  const assignedSet = new Set(plan.assignments.map((a) => a.employeeId));
  const posIndex = buildPositionIndex(snapshot);
  for (const u of plan.unassigned) {
    const e = empById.get(u.employeeId);
    if (!e) {
      blockingConstraintsValid = false;
      issues.push({ check: "unassignedUnknown", detail: `unknown employee ${u.employeeId}` });
      continue;
    }
    if (assignedSet.has(u.employeeId)) {
      blockingConstraintsValid = false;
      issues.push({
        check: "unassignedButAssigned",
        detail: `${u.employeeId} is both assigned and unassigned`,
      });
      continue;
    }
    const expected = minimalBlockingConstraints(e, snapshot, posIndex);
    const declared = [...u.minimalBlockingConstraints].sort();
    const exp = [...expected].sort();
    const matches = declared.length === exp.length && declared.every((x, i) => x === exp[i]);
    if (!matches) {
      // If the employee had NO feasible post, the set must match exactly.
      if (expected.length > 0) {
        blockingConstraintsValid = false;
        issues.push({
          check: "minimalBlocking",
          detail: `${u.employeeId} declared [${declared.join(",")}] != derived [${exp.join(",")}]`,
        });
      }
      // expected.length === 0 means a feasible post exists but the employee was
      // left unassigned (allowed only when mayRemainUnassigned). Record it.
      else if (!e.mayRemainUnassigned) {
        blockingConstraintsValid = false;
        issues.push({
          check: "shouldBeAssigned",
          detail: `${u.employeeId} has a feasible post and may not remain unassigned`,
        });
      }
    }
  }

  const valid =
    hardViolationCount === 0 &&
    duplicateOccupancyCount === 0 &&
    unknown === 0 &&
    planHashMatches &&
    scoreMatches &&
    blockingConstraintsValid;

  return {
    valid,
    hardViolationCount,
    duplicateOccupancyCount,
    unknownEmployeeOrPosition: unknown,
    planHashMatches,
    scoreMatches,
    blockingConstraintsValid,
    issues,
  };
}
