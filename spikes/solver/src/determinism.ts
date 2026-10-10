/**
 * determinism.ts — D-ST-05 criterion (2): byte-identical plan hash over 3 runs on
 * the same snapshot + seed, for the baseline (and CP-SAT when --cpsat is given).
 * Also doubles as the REPLAY harness: it regenerates the snapshot from (size,
 * seed) each run, proving replay from stored parameters reproduces the plan.
 *
 * Usage:
 *   node --import tsx src/determinism.ts <out.json> [--cpsat "docker run --rm -i st-m01-13-cpsat:tmp"]
 */

import { writeFileSync } from "node:fs";
import { BaselineSolver } from "./baseline.js";
import { CommandCpSatRunner, CpSatSolver } from "./cpsat.js";
import { generateSnapshot } from "./generate.js";
import type { SolverPort } from "./SolverPort.js";
import { validate } from "./validator.js";

const SEED = 42;
const RUNS = 3;

interface DetEntry {
  solver: string;
  size: number;
  seed: number;
  hashes: string[];
  identical: boolean;
  allValid: boolean;
  snapshotIds: string[];
  snapshotStable: boolean;
}

async function threeRuns(solver: SolverPort, size: number): Promise<DetEntry> {
  const hashes: string[] = [];
  const snapshotIds: string[] = [];
  let allValid = true;
  for (let r = 0; r < RUNS; r++) {
    // Regenerate from parameters each time (replay from stored evidence).
    const snap = generateSnapshot({ employeeCount: size, seed: SEED });
    snapshotIds.push(snap.snapshotId);
    const plan = await solver.solve(snap, { seed: SEED });
    hashes.push(plan.planHash);
    if (!validate(snap, plan).valid) allValid = false;
  }
  const identical = hashes.every((h) => h === hashes[0]);
  const snapshotStable = snapshotIds.every((s) => s === snapshotIds[0]);
  return { solver: solver.name, size, seed: SEED, hashes, identical, allValid, snapshotIds, snapshotStable };
}

async function main() {
  const outPath = process.argv[2] ?? "bench-results/determinism.json";
  const cpsatIdx = process.argv.indexOf("--cpsat");
  const cpsatCmd = cpsatIdx >= 0 ? process.argv[cpsatIdx + 1] : undefined;

  const entries: DetEntry[] = [];
  const baseline = new BaselineSolver();
  for (const size of [1_000, 10_000]) {
    const e = await threeRuns(baseline, size);
    entries.push(e);
    // eslint-disable-next-line no-console
    console.log(`baseline ${size}: identical=${e.identical} valid=${e.allValid} hash=${e.hashes[0]!.slice(0, 16)}`);
  }

  if (cpsatCmd) {
    const parts = cpsatCmd.split(/\s+/);
    const runner = new CommandCpSatRunner(parts[0]!, parts.slice(1));
    const cpsat = new CpSatSolver(runner);
    for (const size of [1_000, 10_000]) {
      try {
        const e = await threeRuns(cpsat, size);
        entries.push(e);
        // eslint-disable-next-line no-console
        console.log(`cpsat ${size}: identical=${e.identical} valid=${e.allValid} hash=${e.hashes[0]!.slice(0, 16)}`);
      } catch (err) {
        // eslint-disable-next-line no-console
        console.error(`cpsat ${size}: FAILED ${(err as Error).message}`);
      }
    }
  }

  writeFileSync(outPath, JSON.stringify({ runs: RUNS, seed: SEED, entries }, null, 2));
  // eslint-disable-next-line no-console
  console.log(`wrote ${outPath}`);
}

main().catch((e) => {
  // eslint-disable-next-line no-console
  console.error(e);
  process.exit(1);
});
