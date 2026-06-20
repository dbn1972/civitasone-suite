import { performance } from "node:perf_hooks";

export type PerfBudget = {
  /** p95 latency ceiling in milliseconds */
  p95Ms: number;
  samples?: number;
  warmup?: number;
};

export async function measureP95(fn: () => Promise<void>, budget: PerfBudget): Promise<number> {
  const samples = budget.samples ?? 20;
  const warmup = budget.warmup ?? 3;
  for (let i = 0; i < warmup; i++) await fn();

  const times: number[] = [];
  for (let i = 0; i < samples; i++) {
    const t0 = performance.now();
    await fn();
    times.push(performance.now() - t0);
  }
  times.sort((a, b) => a - b);
  const idx = Math.min(times.length - 1, Math.floor(samples * 0.95));
  return times[idx] ?? 0;
}

export async function assertP95(fn: () => Promise<void>, budget: PerfBudget): Promise<void> {
  const p95 = await measureP95(fn, budget);
  if (p95 > budget.p95Ms) {
    throw new Error(`p95 ${p95.toFixed(2)}ms exceeds budget ${budget.p95Ms}ms`);
  }
}

/** EXPLAIN plan must use an index scan (not Seq Scan on large tables). */
export function assertIndexUsed(planText: string): void {
  const usesIndex = /Index (Only )?Scan/i.test(planText);
  const seqScan = /Seq Scan/i.test(planText);
  if (seqScan && !usesIndex) {
    throw new Error(`expected index scan, got:\n${planText}`);
  }
}
