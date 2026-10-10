/**
 * Benchmark harness for D-ST-07 criterion (3): evaluate one rule pack across a
 * 100k synthetic workforce on ONE worker in ≤ 10 minutes.
 *
 * Single-threaded by construction: one ZenPolicyEvaluator, one await loop, no
 * worker_threads, no Promise.all fan-out. Writes a machine-readable JSON report
 * to the path given as argv[2] (default spikes/policy/bench-results/benchmark.json).
 *
 * Usage:
 *   node --import tsx src/benchmark.ts [outPath] [count] [seed] [packId]
 */

import { mkdirSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { ZenPolicyEvaluator } from "./ZenPolicyEvaluator.js";
import { syntheticPacks, minTenurePack } from "./rulepacks.js";
import { generateWorkforce } from "./generate.js";

const THRESHOLD_MS = 10 * 60 * 1000; // 10 minutes

export interface BenchmarkResult {
  packId: string;
  packHash: string;
  employeeCount: number;
  seed: number;
  workers: number;
  elapsedMs: number;
  thresholdMs: number;
  pass: boolean;
  evalsPerSecond: number;
  node: string;
  arch: string;
  platform: string;
  timestampUtc: string;
  // A spot-check hash so the benchmark run is tied to a concrete output set.
  sampleDecisionHashes: { index: number; decisionHash: string }[];
}

export async function runBenchmark(
  count: number,
  seed: number,
  packId: string,
): Promise<BenchmarkResult> {
  const evaluator = new ZenPolicyEvaluator();
  for (const p of syntheticPacks) await evaluator.loadPack(p);
  const packInfo = evaluator.listPacks().find((p) => p.packId === packId);
  if (!packInfo) throw new Error(`unknown pack ${packId}`);

  const workforce = generateWorkforce(count, seed);
  const sampleIndices = new Set([0, Math.floor(count / 2), count - 1]);
  const sampleDecisionHashes: { index: number; decisionHash: string }[] = [];

  const start = process.hrtime.bigint();
  for (let i = 0; i < workforce.length; i++) {
    const emp = workforce[i];
    const decision = await evaluator.evaluate(packId, {
      tenureMonths: emp.tenureMonths,
      hardshipPosting: emp.hardshipPosting,
      sensitivePost: emp.sensitivePost,
      monthsInPost: emp.monthsInPost,
      medicalGround: emp.medicalGround,
      spouseGround: emp.spouseGround,
      disability: emp.disability,
    });
    if (sampleIndices.has(i)) {
      sampleDecisionHashes.push({ index: i, decisionHash: decision.decisionHash });
    }
  }
  const end = process.hrtime.bigint();
  evaluator.dispose();

  const elapsedMs = Number(end - start) / 1e6;
  return {
    packId: packInfo.packId,
    packHash: packInfo.packHash,
    employeeCount: count,
    seed,
    workers: 1,
    elapsedMs: Math.round(elapsedMs),
    thresholdMs: THRESHOLD_MS,
    pass: elapsedMs <= THRESHOLD_MS,
    evalsPerSecond: Math.round((count / elapsedMs) * 1000),
    node: process.version,
    arch: process.arch,
    platform: process.platform,
    timestampUtc: new Date().toISOString(),
    sampleDecisionHashes,
  };
}

async function main(): Promise<void> {
  const outPath = process.argv[2] ?? "bench-results/benchmark.json";
  const count = Number(process.argv[3] ?? 100_000);
  const seed = Number(process.argv[4] ?? 20261009);
  const packId = process.argv[5] ?? minTenurePack.packId;

  const result = await runBenchmark(count, seed, packId);
  mkdirSync(dirname(outPath), { recursive: true });
  writeFileSync(outPath, JSON.stringify(result, null, 2));
  // eslint-disable-next-line no-console
  console.log(JSON.stringify(result, null, 2));
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  main().catch((err) => {
    // eslint-disable-next-line no-console
    console.error(err);
    process.exit(1);
  });
}
