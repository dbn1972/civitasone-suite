/**
 * cpsat.ts — the OR-Tools CP-SAT adapter (candidate per D-ST-05(b)).
 *
 * CP-SAT runs as a SIDECAR PROCESS: this adapter serialises the frozen snapshot
 * to JSON on stdin, invokes a Python `ortools` solver (pinned versions, run in a
 * throwaway Docker image built with a dedicated buildx builder), reads the raw
 * assignment list back on stdout, then rebuilds the AllocationPlan using the SAME
 * shared feasibility + scoring + hashing modules the baseline uses. This is the
 * key to criterion (3): the plan is scored and hashed by OUR canonical functions,
 * so CP-SAT's score is directly comparable to the baseline's and the independent
 * validator judges both identically.
 *
 * The adapter never trusts the sidecar's own scoring. It only accepts the
 * (employeeId → positionId) pairs; everything else is recomputed on the TS side.
 */

import { spawn } from "node:child_process";
import type {
  AllocationPlan,
  AllocationSnapshot,
  Assignment,
  SolveOptions,
  SolverPort,
  UnassignedEmployee,
} from "./SolverPort.js";
import { buildPositionIndex, isHardFeasible, minimalBlockingConstraints } from "./feasibility.js";
import { buildScoringContext, pairScore, planHash, totalScore } from "./scoring.js";

export const CPSAT_NAME = "ortools-cpsat-sidecar";
export const CPSAT_VERSION = "0.1.0";

export interface CpSatRunner {
  /** Runs the sidecar with the serialised request, returns raw stdout. */
  run(requestJson: string, timeBudgetMsPerPartition: number): Promise<string>;
}

/**
 * Default runner: pipes to a command (e.g. `docker run --rm -i <image>` or
 * `python3 solver.py`). The command is injected so tests can stub it and the
 * benchmark can point it at the docker image.
 */
export class CommandCpSatRunner implements CpSatRunner {
  constructor(
    private readonly command: string,
    private readonly args: readonly string[],
  ) {}

  run(requestJson: string, _timeBudgetMsPerPartition: number): Promise<string> {
    return new Promise((resolve, reject) => {
      const child = spawn(this.command, this.args, { stdio: ["pipe", "pipe", "pipe"] });
      let out = "";
      let err = "";
      child.stdout.on("data", (d) => (out += d.toString()));
      child.stderr.on("data", (d) => (err += d.toString()));
      child.on("error", reject);
      child.on("close", (code) => {
        if (code === 0) resolve(out);
        else reject(new Error(`cpsat sidecar exited ${code}: ${err.slice(0, 2000)}`));
      });
      child.stdin.write(requestJson);
      child.stdin.end();
    });
  }
}

/** The JSON contract exchanged with the Python sidecar. */
interface SidecarRequest {
  partitions: Array<{
    key: string;
    employees: Array<{ id: string }>;
    positions: Array<{ id: string; capacity: number }>;
    // Feasible (employeeIndex, positionIndex, integerScore) edges per partition.
    edges: Array<[number, number, number]>;
  }>;
}

interface SidecarResponse {
  // partitionKey -> list of [employeeId, positionId]
  assignments: Array<[string, string]>;
}

export class CpSatSolver implements SolverPort {
  readonly name = CPSAT_NAME;
  readonly version = CPSAT_VERSION;

  constructor(private readonly runner: CpSatRunner) {}

  async solve(snapshot: AllocationSnapshot, options: SolveOptions): Promise<AllocationPlan> {
    const ctx = buildScoringContext(snapshot.softObjectives, snapshot.preferences);
    const employees = [...snapshot.employees].sort((a, b) => cmp(a.id, b.id));
    const positions = [...snapshot.positions].sort((a, b) => cmp(a.id, b.id));

    // Partition exactly as the baseline does.
    const partEmp = new Map<string, typeof employees>();
    for (const e of employees) {
      const k = snapshot.partitionOf(e);
      (partEmp.get(k) ?? partEmp.set(k, []).get(k)!).push(e);
    }
    const partPos = new Map<string, typeof positions>();
    for (const p of positions) {
      const k = `${p.cadre}:${p.jurisdictionUnitId}`;
      (partPos.get(k) ?? partPos.set(k, []).get(k)!).push(p);
    }

    const req: SidecarRequest = { partitions: [] };
    for (const [key, emps] of [...partEmp.entries()].sort((a, b) => cmp(a[0], b[0]))) {
      const posns = partPos.get(key) ?? [];
      if (posns.length === 0) continue;
      const edges: Array<[number, number, number]> = [];
      for (let i = 0; i < emps.length; i++) {
        for (let j = 0; j < posns.length; j++) {
          if (!isHardFeasible(emps[i]!, posns[j]!, snapshot.hardConstraints)) continue;
          // Same deterministic tie-break scaling as the baseline so CP-SAT's
          // optimum is unique and matches the baseline optimum.
          const base = pairScore(emps[i]!, posns[j]!, ctx);
          const scaled = base * (emps.length * posns.length + 1) - (i * posns.length + j);
          edges.push([i, j, scaled]);
        }
      }
      req.partitions.push({
        key,
        employees: emps.map((e) => ({ id: e.id })),
        positions: posns.map((p) => ({ id: p.id, capacity: p.capacity })),
        edges,
      });
    }

    const raw = await this.runner.run(
      JSON.stringify(req),
      options.timeBudgetMsPerPartition ?? 15 * 60 * 1000,
    );
    const resp = JSON.parse(raw) as SidecarResponse;

    // Rebuild the plan from the pairs only, scoring with OUR functions.
    const empById = new Map(snapshot.employees.map((e) => [e.id, e]));
    const posById = new Map(snapshot.positions.map((p) => [p.id, p]));
    const assignments: Assignment[] = [];
    const assigned = new Set<string>();
    for (const [eid, pid] of resp.assignments) {
      const e = empById.get(eid);
      const p = posById.get(pid);
      if (!e || !p) continue;
      // Defensive: never accept a hard-infeasible pair even if the sidecar emits
      // one. P06 is enforced on the TS side regardless of the solver.
      if (!isHardFeasible(e, p, snapshot.hardConstraints)) continue;
      assignments.push({ employeeId: eid, positionId: pid, score: pairScore(e, p, ctx) });
      assigned.add(eid);
    }
    assignments.sort((a, b) =>
      a.employeeId < b.employeeId
        ? -1
        : a.employeeId > b.employeeId
          ? 1
          : cmp(a.positionId, b.positionId),
    );

    const posIndex = buildPositionIndex(snapshot);
    const unassigned: UnassignedEmployee[] = [];
    for (const e of employees) {
      if (assigned.has(e.id)) continue;
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

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}
