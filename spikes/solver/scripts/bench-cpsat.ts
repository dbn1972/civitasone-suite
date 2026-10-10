import { writeFileSync } from "node:fs";
import { arch } from "node:os";
import { performance } from "node:perf_hooks";
import { BaselineSolver } from "../src/baseline.js";
import { CommandCpSatRunner, CpSatSolver } from "../src/cpsat.js";
import { generateSnapshot } from "../src/generate.js";
import { validate } from "../src/validator.js";

const SEED = 42;
const cmd = process.argv[2]!.split(/\s+/);
const runner = new CommandCpSatRunner(cmd[0]!, cmd.slice(1));
const cpsat = new CpSatSolver(runner);
const baseline = new BaselineSolver();
const results: any[] = [];
for (const size of [1000, 10000]) {
  const snap = generateSnapshot({ employeeCount: size, seed: SEED });
  const tb = performance.now();
  const bp = await baseline.solve(snap, { seed: SEED });
  const bms = performance.now() - tb;
  const tc = performance.now();
  const cp = await cpsat.solve(snap, { seed: SEED });
  const cms = performance.now() - tc;
  const vb = validate(snap, bp);
  const vc = validate(snap, cp);
  results.push({
    size,
    baseline: { wallMs: Math.round(bms), score: bp.score, assigned: bp.assignments.length, valid: vb.valid, hardViolations: vb.hardViolationCount, dupOccupancy: vb.duplicateOccupancyCount, planHash: bp.planHash },
    cpsat: { wallMs: Math.round(cms), score: cp.score, assigned: cp.assignments.length, valid: vc.valid, hardViolations: vc.hardViolationCount, dupOccupancy: vc.duplicateOccupancyCount, planHash: cp.planHash },
    scoreGeqBaseline: cp.score >= bp.score,
    scoresEqual: cp.score === bp.score,
  });
  console.log(`size=${size} baseline score=${bp.score} (${Math.round(bms)}ms) cpsat score=${cp.score} (${Math.round(cms)}ms) cpsat>=baseline=${cp.score>=bp.score}`);
}
writeFileSync("bench-results/benchmark-cpsat.json", JSON.stringify({ generatedAt: new Date().toISOString(), host: { arch: arch() }, seed: SEED, note: "arm64 host; re-run on x64 before D-ST-05 final lock", results }, null, 2));
console.log("wrote bench-results/benchmark-cpsat.json");
