import { generateSnapshot } from "../src/generate.js";
import { hardViolations, minimalBlockingConstraints, buildPositionIndex } from "../src/feasibility.js";
import type { HardConstraintKind, SnapshotEmployee, AllocationSnapshot } from "../src/SolverPort.js";

function betterSet(a: HardConstraintKind[], b: HardConstraintKind[]): boolean {
  if (a.length !== b.length) return a.length < b.length;
  for (let i=0;i<a.length;i++){ if (a[i] !== b[i]) return a[i]! < b[i]!; }
  return false;
}
// Full-scan brute force with the SAME (size, lexicographic) tie-break.
function brute(e: SnapshotEmployee, snap: AllocationSnapshot): HardConstraintKind[] {
  let best: HardConstraintKind[] | null = null;
  for (const p of snap.positions) {
    const v = [...hardViolations(e, p, snap.hardConstraints)].sort();
    if (v.length === 0) return [];
    if (best === null || betterSet(v, best)) best = v;
  }
  return best ?? [];
}

let totalMismatch = 0;
for (const [size, seed] of [[1000,42],[2000,7],[3000,1234],[5000,99999]] as const) {
  const snap = generateSnapshot({ employeeCount: size, seed });
  const idx = buildPositionIndex(snap);
  let mismatch = 0;
  for (const e of snap.employees) {
    const b = brute(e, snap);
    const f = minimalBlockingConstraints(e, snap, idx);
    const same = b.length === f.length && b.every((x,i)=>x===f[i]);
    if (!same) mismatch++;
  }
  totalMismatch += mismatch;
  console.log(`size=${size} seed=${seed} setMismatch=${mismatch}`);
}
console.log(totalMismatch === 0 ? "FASTPATH_MATCHES_BRUTE=PASS" : "FASTPATH_MATCHES_BRUTE=FAIL");
