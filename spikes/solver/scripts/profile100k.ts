import { performance } from "node:perf_hooks";
import { generateSnapshot } from "../src/generate.js";
import { isHardFeasible } from "../src/feasibility.js";
import { MinCostMaxFlow } from "../src/mcmf.js";
import { buildScoringContext, pairScore } from "../src/scoring.js";

const snap = generateSnapshot({ employeeCount: 100000, seed: 42 });
const ctx = buildScoringContext(snap.softObjectives, snap.preferences);
const employees = [...snap.employees].sort((a, b) => (a.id < b.id ? -1 : 1));
const positions = [...snap.positions].sort((a, b) => (a.id < b.id ? -1 : 1));

const partEmp = new Map<string, typeof employees>();
for (const e of employees) {
  const k = snap.partitionOf(e);
  (partEmp.get(k) ?? partEmp.set(k, []).get(k)!).push(e);
}
const partPos = new Map<string, typeof positions>();
for (const p of positions) {
  const k = `${p.cadre}:${p.jurisdictionUnitId}`;
  (partPos.get(k) ?? partPos.set(k, []).get(k)!).push(p);
}

const timings: Array<{ key: string; E: number; P: number; edges: number; ms: number }> = [];
for (const [key, emps] of [...partEmp.entries()].sort((a, b) => (a[0] < b[0] ? -1 : 1))) {
  const posns = partPos.get(key) ?? [];
  if (posns.length === 0) continue;
  const E = emps.length;
  const P = posns.length;
  const t0 = performance.now();
  const mcmf = new MinCostMaxFlow(E + P + 2);
  for (let i = 0; i < E; i++) mcmf.addEdge(0, 1 + i, 1, 0);
  for (let j = 0; j < P; j++) mcmf.addEdge(1 + E + j, E + P + 1, posns[j]!.capacity, 0);
  let edges = 0;
  for (let i = 0; i < E; i++) {
    for (let j = 0; j < P; j++) {
      if (!isHardFeasible(emps[i]!, posns[j]!, snap.hardConstraints)) continue;
      const base = pairScore(emps[i]!, posns[j]!, ctx);
      const scaled = base * (E * P + 1) - (i * P + j);
      mcmf.addEdge(1 + i, 1 + E + j, 1, -scaled);
      edges++;
    }
  }
  mcmf.run(0, E + P + 1);
  const ms = performance.now() - t0;
  timings.push({ key, E, P, edges, ms: Math.round(ms) });
  console.log(`${key} E=${E} P=${P} edges=${edges} ms=${Math.round(ms)}`);
}
timings.sort((a, b) => b.ms - a.ms);
console.log("SLOWEST:", JSON.stringify(timings.slice(0, 5)));
console.log("TOTAL ms:", timings.reduce((s, t) => s + t.ms, 0));
