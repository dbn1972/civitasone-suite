/**
 * benchmark.ts — wall-time benchmark + validation for the baseline at 1k, 10k,
 * 100k (D-ST-05 criterion 1 and the extra 1k/100k timings) and, optionally, the
 * CP-SAT sidecar. Writes a benchmark JSON to the given path.
 *
 * Usage:
 *   node --import tsx src/benchmark.ts <out.json> [--cpsat "docker run --rm -i st-m01-13-cpsat:tmp"]
 *
 * Determinism / arch note: numbers below are from this arm64 host. D-ST-05 final
 * lock requires a re-run on x64 (recorded in REPORT.md).
 */

import { writeFileSync } from "node:fs";
import { arch, cpus, totalmem } from "node:os";
import { performance } from "node:perf_hooks";
import { BaselineSolver } from "./baseline.js";
import { CommandCpSatRunner, CpSatSolver } from "./cpsat.js";
import { generateSnapshot } from "./generate.js";
import type { AllocationPlan, AllocationSnapshot, SolverPort } from "./SolverPort.js";
import { validate } from "./validator.js";

const SEED = 42;
const SIZES = [1_000, 10_000, 100_000];
const PARTITION_BUDGET_MS = 15 * 60 * 1000; // D-ST-05(1): ≤ 15 min / 10k partition.

interface SizeResult {
  solver: string;
  employees: number;
  positions: number;
  partitions: number;
  largestPartitionEmployees: number;
  wallMs: number;
  assigned: number;
  unassigned: number;
  score: number;
  planHash: string;
  valid: boolean;
  hardViolations: number;
  duplicateOccupancy: number;
}

async function runOne(solver: SolverPort, snap: AllocationSnapshot): Promise<SizeResult> {
  const t0 = performance.now();
  const plan: AllocationPlan = await solver.solve(snap, {
    seed: SEED,
    timeBudgetMsPerPartition: PARTITION_BUDGET_MS,
  });
  const wallMs = performance.now() - t0;
  const v = validate(snap, plan);

  const parts = new Map<string, number>();
  for (const e of snap.employees) {
    const k = snap.partitionOf(e);
    parts.set(k, (parts.get(k) ?? 0) + 1);
  }
  const largest = Math.max(...parts.values());

  return {
    solver: solver.name,
    employees: snap.employees.length,
    positions: snap.positions.length,
    partitions: parts.size,
    largestPartitionEmployees: largest,
    wallMs: Math.round(wallMs),
    assigned: plan.assignments.length,
    unassigned: plan.unassigned.length,
    score: plan.score,
    planHash: plan.planHash,
    valid: v.valid,
    hardViolations: v.hardViolationCount,
    duplicateOccupancy: v.duplicateOccupancyCount,
  };
}

async function main() {
  const outPath = process.argv[2] ?? "bench-results/benchmark.json";
  const cpsatIdx = process.argv.indexOf("--cpsat");
  const cpsatCmd = cpsatIdx >= 0 ? process.argv[cpsatIdx + 1] : undefined;

  const results: SizeResult[] = [];
  const baseline = new BaselineSolver();

  for (const size of SIZES) {
    const snap = generateSnapshot({ employeeCount: size, seed: SEED });
    const r = await runOne(baseline, snap);
    results.push(r);
    // eslint-disable-next-line no-console
    console.log(
      `baseline ${size}: ${r.wallMs}ms, assigned ${r.assigned}/${r.employees}, ` +
        `valid=${r.valid}, hash=${r.planHash.slice(0, 12)}`,
    );
  }

  // CP-SAT: only up to 10k by default (sidecar), gated on the --cpsat command.
  if (cpsatCmd) {
    const parts = cpsatCmd.split(/\s+/);
    const runner = new CommandCpSatRunner(parts[0]!, parts.slice(1));
    const cpsat = new CpSatSolver(runner);
    for (const size of [1_000, 10_000]) {
      const snap = generateSnapshot({ employeeCount: size, seed: SEED });
      try {
        const r = await runOne(cpsat, snap);
        results.push(r);
        // eslint-disable-next-line no-console
        console.log(
          `cpsat ${size}: ${r.wallMs}ms, assigned ${r.assigned}/${r.employees}, ` +
            `valid=${r.valid}, hash=${r.planHash.slice(0, 12)}`,
        );
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`cpsat ${size}: FAILED ${(err as Error).message}`);
      }
    }
  }

  const report = {
    generatedAt: new Date().toISOString(),
    host: { arch: arch(), cpus: cpus().length, totalMemGb: Math.round(totalmem() / 1e9) },
    seed: SEED,
    partitionBudgetMs: PARTITION_BUDGET_MS,
    note: "arm64 host; D-ST-05 final lock requires re-run on x64.",
    results,
  };
  writeFileSync(outPath, JSON.stringify(report, null, 2));
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
