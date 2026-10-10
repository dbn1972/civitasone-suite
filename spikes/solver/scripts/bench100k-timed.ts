import { writeFileSync } from "node:fs";
import { arch } from "node:os";
import { performance } from "node:perf_hooks";
import { BaselineSolver } from "../src/baseline.js";
import { generateSnapshot } from "../src/generate.js";
import { validate } from "../src/validator.js";

const SEED = 42;
const results: any[] = [];
for (const size of [1000, 10000, 100000]) {
  const snap = generateSnapshot({ employeeCount: size, seed: SEED });
  const parts = new Map<string, number>();
  for (const e of snap.employees) { const k = snap.partitionOf(e); parts.set(k,(parts.get(k)??0)+1); }
  const t0 = performance.now();
  const plan = await new BaselineSolver().solve(snap, { seed: SEED });
  const solveMs = performance.now() - t0;
  const tv = performance.now();
  const v = validate(snap, plan);
  const valMs = performance.now() - tv;
  const r = { size, positions: snap.positions.length, partitions: parts.size, largestPartition: Math.max(...parts.values()), solveMs: Math.round(solveMs), solveMin: +(solveMs/60000).toFixed(2), validateMs: Math.round(valMs), assigned: plan.assignments.length, unassigned: plan.unassigned.length, score: plan.score, planHash: plan.planHash, valid: v.valid, hardViolations: v.hardViolationCount, dupOccupancy: v.duplicateOccupancyCount };
  results.push(r);
  console.log(`size=${size} solve=${r.solveMs}ms (${r.solveMin}min) validate=${r.validateMs}ms parts=${r.partitions} largest=${r.largestPartition} assigned=${r.assigned} score=${r.score} valid=${r.valid} hash=${r.planHash.slice(0,12)}`);
}
writeFileSync("bench-results/benchmark.json", JSON.stringify({ generatedAt: new Date().toISOString(), host: { arch: arch() }, seed: SEED, solver: "ts-baseline-mcmf-localsearch", partitionBudgetMs: 15*60*1000, note: "arm64 host; solveMs is the D-ST-05(1) metric (partitions solved sequentially; independent partitions are parallelizable). Re-run on x64 before final lock.", results }, null, 2));
console.log("wrote bench-results/benchmark.json");
