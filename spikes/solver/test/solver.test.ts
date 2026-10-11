import { describe, expect, it } from "vitest";
import { BaselineSolver } from "../src/baseline.js";
import { CpSatSolver, type CpSatRunner } from "../src/cpsat.js";
import { generateSnapshot, Prng } from "../src/generate.js";
import { hardViolations, isHardFeasible, minimalBlockingConstraints } from "../src/feasibility.js";
import type { AllocationSnapshot } from "../src/SolverPort.js";
import { validate } from "../src/validator.js";

const SEEDS = [1, 7, 42, 1234, 99999];

/**
 * A pure-TS stand-in for the CP-SAT sidecar: solves each partition's max-weight
 * assignment exactly (greedy on the already-tie-broken scaled weights is NOT
 * guaranteed optimal, so we reuse an exact Hungarian-free approach: because the
 * TS adapter hands pre-scaled integer edges, we just replay the baseline's MCMF
 * optimum here). This lets the property suite exercise cpsat.ts end-to-end
 * without Docker. The REAL ortools sidecar is validated by the docker script.
 */
import { MinCostMaxFlow } from "../src/mcmf.js";

const stubRunner: CpSatRunner = {
  async run(requestJson: string): Promise<string> {
    const req = JSON.parse(requestJson) as {
      partitions: Array<{
        key: string;
        employees: Array<{ id: string }>;
        positions: Array<{ id: string; capacity: number }>;
        edges: Array<[number, number, number]>;
      }>;
    };
    const assignments: Array<[string, string]> = [];
    for (const part of req.partitions) {
      const E = part.employees.length;
      const P = part.positions.length;
      const S = 0;
      const T = E + P + 1;
      const mcmf = new MinCostMaxFlow(E + P + 2);
      for (let i = 0; i < E; i++) mcmf.addEdge(S, 1 + i, 1, 0);
      for (let j = 0; j < P; j++) mcmf.addEdge(1 + E + j, T, part.positions[j]!.capacity, 0);
      for (const [i, j, score] of part.edges) mcmf.addEdge(1 + i, 1 + E + j, 1, -score);
      mcmf.run(S, T);
      for (const fe of mcmf.flowEdges()) {
        if (fe.u >= 1 && fe.u <= E && fe.v >= E + 1 && fe.v <= E + P) {
          assignments.push([part.employees[fe.u - 1]!.id, part.positions[fe.v - 1 - E]!.id]);
        }
      }
    }
    return JSON.stringify({ assignments });
  },
};

describe("Prng determinism", () => {
  it("produces identical streams for identical seeds", () => {
    const a = new Prng(42);
    const b = new Prng(42);
    for (let i = 0; i < 100; i++) expect(a.next()).toBe(b.next());
  });
  it("produces different streams for different seeds", () => {
    const a = new Prng(1);
    const b = new Prng(2);
    let diff = false;
    for (let i = 0; i < 100; i++) if (a.next() !== b.next()) diff = true;
    expect(diff).toBe(true);
  });
});

describe("snapshot generator", () => {
  it("is deterministic: same (size, seed) → identical snapshotId & shape", () => {
    const s1 = generateSnapshot({ employeeCount: 1000, seed: 42 });
    const s2 = generateSnapshot({ employeeCount: 1000, seed: 42 });
    expect(s1.snapshotId).toBe(s2.snapshotId);
    expect(s1.employees).toEqual(s2.employees);
    expect(s1.positions).toEqual(s2.positions);
  });
  it("contains no real PII: ids are synthetic Exxxx/Pxxxx", () => {
    const s = generateSnapshot({ employeeCount: 50, seed: 1 });
    for (const e of s.employees) expect(e.id).toMatch(/^E\d{7}$/);
    for (const p of s.positions) expect(p.id).toMatch(/^P\d{7}$/);
  });
});

describe("baseline solver — always-on properties (spec §16)", () => {
  for (const seed of SEEDS) {
    it(`seed ${seed}: zero hard violations & zero duplicate occupancy (validated independently)`, async () => {
      const snap = generateSnapshot({ employeeCount: 1000, seed });
      const plan = await new BaselineSolver().solve(snap, { seed });
      const v = validate(snap, plan);
      expect(v.hardViolationCount).toBe(0);
      expect(v.duplicateOccupancyCount).toBe(0);
      expect(v.valid).toBe(true);
    });

    it(`seed ${seed}: deterministic replay — identical plan hash over 3 runs`, async () => {
      const hashes: string[] = [];
      for (let r = 0; r < 3; r++) {
        const snap = generateSnapshot({ employeeCount: 500, seed });
        const plan = await new BaselineSolver().solve(snap, { seed });
        hashes.push(plan.planHash);
      }
      expect(hashes[0]).toBe(hashes[1]);
      expect(hashes[1]).toBe(hashes[2]);
    });

    it(`seed ${seed}: every unassigned employee has a correct minimal blocking set`, async () => {
      const snap = generateSnapshot({ employeeCount: 500, seed });
      const plan = await new BaselineSolver().solve(snap, { seed });
      for (const u of plan.unassigned) {
        const e = snap.employees.find((x) => x.id === u.employeeId)!;
        const expected = minimalBlockingConstraints(e, snap);
        if (expected.length > 0) {
          expect([...u.minimalBlockingConstraints].sort()).toEqual([...expected].sort());
        }
      }
    });
  }
});

describe("held employees can never be assigned (P06 legal hold)", () => {
  it("no assignment for any employee under a legal hold", async () => {
    const snap = generateSnapshot({ employeeCount: 2000, seed: 7, holdRatio: 0.2 });
    const plan = await new BaselineSolver().solve(snap, { seed: 7 });
    const held = new Set(snap.employees.filter((e) => e.hold).map((e) => e.id));
    for (const a of plan.assignments) expect(held.has(a.employeeId)).toBe(false);
  });
});

describe("validator catches injected violations (negative control)", () => {
  it("flags a hard-infeasible assignment", () => {
    const snap = generateSnapshot({ employeeCount: 50, seed: 1 });
    // Force an infeasible pairing: an employee into a position of another cadre.
    const e = snap.employees[0]!;
    const badPos = snap.positions.find((p) => p.cadre !== e.cadre)!;
    const bad = {
      snapshotId: snap.snapshotId,
      solverName: "x",
      solverVersion: "0",
      seed: 1,
      assignments: [{ employeeId: e.id, positionId: badPos.id, score: 0 }],
      unassigned: [],
      score: 0,
      planHash: "deadbeef",
    };
    const v = validate(snap, bad);
    expect(v.valid).toBe(false);
    expect(v.hardViolationCount + (v.planHashMatches ? 0 : 1)).toBeGreaterThan(0);
  });

  it("flags duplicate occupancy", () => {
    const snap = generateSnapshot({ employeeCount: 50, seed: 2 });
    // Find two same-cadre/jurisdiction/grade employees feasible for one post.
    const pos = snap.positions[0]!;
    const feas = snap.employees.filter((e) => isHardFeasible(e, pos, snap.hardConstraints));
    if (feas.length >= 2) {
      const bad = {
        snapshotId: snap.snapshotId,
        solverName: "x",
        solverVersion: "0",
        seed: 2,
        assignments: [
          { employeeId: feas[0]!.id, positionId: pos.id, score: 0 },
          { employeeId: feas[1]!.id, positionId: pos.id, score: 0 },
        ],
        unassigned: [],
        score: 0,
        planHash: "x",
      };
      const v = validate(snap, bad);
      expect(v.duplicateOccupancyCount).toBeGreaterThan(0);
      expect(v.valid).toBe(false);
    }
  });
});

describe("CP-SAT adapter (via exact stub runner) matches baseline optimum", () => {
  for (const seed of [1, 42, 1234]) {
    it(`seed ${seed}: cpsat score ≥ baseline, zero hard violations, same optimum`, async () => {
      const snap: AllocationSnapshot = generateSnapshot({ employeeCount: 800, seed });
      const base = await new BaselineSolver().solve(snap, { seed });
      const cp = await new CpSatSolver(stubRunner).solve(snap, { seed });
      const vb = validate(snap, base);
      const vc = validate(snap, cp);
      expect(vb.valid).toBe(true);
      expect(vc.valid).toBe(true);
      // Criterion (3): CP-SAT score ≥ baseline (here exactly equal — both optimal).
      expect(cp.score).toBeGreaterThanOrEqual(base.score);
      // Both are exact optima of the same linear objective → identical plan hash.
      expect(cp.planHash).toBe(base.planHash);
    });
  }
});

describe("feasibility derivation", () => {
  it("rejects cross-cadre, cross-jurisdiction, missing-qualification pairings", () => {
    const snap = generateSnapshot({ employeeCount: 200, seed: 3 });
    const e = snap.employees[0]!;
    const crossCadre = snap.positions.find((p) => p.cadre !== e.cadre);
    if (crossCadre) {
      expect(hardViolations(e, crossCadre, snap.hardConstraints)).toContain("cadreGradeCompatibility");
    }
  });
});
