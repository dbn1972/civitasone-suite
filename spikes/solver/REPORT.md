# ST-M01-13 — Allocation solver spike report (D-ST-05, D-ST-22)

**Spec:** §7 (mass transfer allocation engine), §15 (performance targets), §16
(testing / always-on properties).
**Decisions:** D-ST-05 (allocation solver runtime — PROPOSED; this spike gathers
the data for the final lock at the end of M01), D-ST-22 (deployment shape for a
non-Node service — APPROVED). D-ST-06 (solver licensing/hosting) is PROPOSED and
marked "before M01 spike".
**Host:** `cloudsphere-ec2`, architecture **arm64 (aarch64)**. Every number below
is from this arm64 host; the D-ST-05 final lock requires a **re-run on x64**.
**All datasets are SYNTHETIC**, produced by a seeded deterministic PRNG. There is
no real personal data.

> This spike delivers **measured results and this report**, not a production code
> path. `spikes/solver/` is deliberately outside the pnpm workspace.

---

## 1. What was built

| Deliverable | Where | Status |
|---|---|---|
| `SolverPort` TS interface (frozen snapshot in; assignments, unassigned-with-minimal-blocking, score, planHash out) | `src/SolverPort.ts` | Done |
| Seeded deterministic synthetic workforce generator (1k/10k/100k, no PII) | `src/generate.ts` | Done |
| TS BASELINE (default): exact min-cost-flow per partition + local-search pass, deterministic tie-breaking, sha256 canonical plan hash | `src/baseline.ts`, `src/mcmf.ts`, `src/scoring.ts`, `src/feasibility.ts` | Done |
| Independent validator (zero hard violations, zero duplicate occupancy, hash + score recompute, minimal-blocking re-derivation) | `src/validator.ts` | Done |
| Property tests (zero duplicate occupancy, zero hard violations, deterministic replay, minimal-blocking correctness, negative controls) | `test/solver.test.ts` | 26 pass |
| Benchmark + replay harness | `src/benchmark.ts`, `src/determinism.ts`, `scripts/bench100k-timed.ts` | Done |
| **OR-Tools CP-SAT** adapter (sidecar) + pinned throwaway image + CVE scan | `src/cpsat.ts`, `sidecar/solver.py`, `sidecar/Dockerfile`, `scripts/docker-cpsat-build.sh` | Done |
| **Timefold** adapter slot | `src/SolverPort.ts` (`TimefoldAdapterSlot`) | **NOT RUN — blocked on D-ST-06** |

The baseline, the CP-SAT adapter and the validator all share ONE definition of
hard feasibility (`feasibility.ts`) and ONE objective + plan-hash
(`scoring.ts`). The CP-SAT adapter accepts only (employee, position) pairs from
the sidecar and re-scores and re-hashes them on the TS side, so its score is
directly comparable to the baseline and the validator judges both identically.
Hard constraints are enforced on the TS side regardless of the solver (P06).

---

## 2. Results against the pre-registered D-ST-05 thresholds

Evidence files (in `bench-results/`, copied to the evidence dir):
`determinism.json`, `determinism-cpsat.json`, `benchmark-cpsat.json`,
`benchmark.json`, `docker-cpsat.log`, `trivy-cpsat.txt`, `trivy-cpsat.json`,
`vitest.log`, `typecheck.log`.

### (1) Wall time ≤ 15 minutes per 10k-employee partition

| Dataset | Partitions | Largest partition (employees) | Baseline solve time | ≤ 15 min / partition? |
|---|---|---|---|---|
| 1k | 40 | 34 | 0.11 s | **PASS** |
| 10k | 40 | 284 | 18.9 s | **PASS** |
| 100k | 40 | ~2,586 | 42.83 min total (40 partitions, sequential); per-partition ≈ 64 s avg, ≈ 80 s max | **PASS** (per 10k partition) |

Measured 100k (`benchmark.json`): solve 2,569,889 ms (**42.83 min**) sequential
across 40 partitions, largest 2,586 employees; validate 49 s; assigned
97,903/100,000; score 22,465,223; planHash `3e0a36fbad43…`; **valid — 0 hard
violations, 0 duplicate occupancy**.

The synthetic model partitions by (cadre × jurisdiction) = 5 × 8 = 40
partitions. The D-ST-05 metric is **per 10k-employee partition**: the largest
real partition at 100k holds ~2,586 employees and solves in ≈ 60–80 s on arm64
(`scripts/profile100k.ts`), i.e. roughly an order of magnitude under the 15-minute
budget. Partitions are independent and were solved **sequentially** here; a
production engine parallelises them, so the 100k end-to-end wall time is bounded
by the slowest partition, not their sum. **CP-SAT** 10k full-run is 28.8 s
(`benchmark-cpsat.json`), also well under budget.

### (2) Byte-identical plan hash over 3 runs (same snapshot + seed)

| Solver | 1k planHash (3 runs) | 10k planHash (3 runs) | identical? |
|---|---|---|---|
| TS baseline | `51d876594b61…` | `17c7e8f27cf8…` | **PASS (identical ×3)** |
| CP-SAT sidecar | `c397a49e687e…` | `aac13c9566bd…` | **PASS (identical ×3)** |

Source: `determinism.json`, `determinism-cpsat.json` (each regenerates the
snapshot from (size, seed) per run — this is also the replay proof). The hash is
sha256 over the canonically sorted output (assignments by employeeId then
positionId; unassigned by employeeId with sorted blocking sets).

**Finding (important for D-ST-05):** the hash is byte-identical *within* each
solver across runs, but **differs between** the baseline and CP-SAT even though
their objective scores are equal. Both find a score-optimal assignment, but when
several assignments tie on objective value they resolve the tie differently. The
determinism contract therefore holds **per solver + version**, which is what
replay from stored evidence requires (the evidence records the solver name and
version). It does **not** mean two different solvers produce the same plan.
Consequence for adoption: the "exact immutable allocation version that was
reviewed" (spec §7.3) must be pinned to a specific solver build.

### (3) Score ≥ baseline and zero hard violations (independent validator)

| Dataset | Baseline score | CP-SAT score | CP-SAT ≥ baseline? | Baseline valid | CP-SAT valid |
|---|---|---|---|---|---|
| 1k | 158,479 | 158,479 | **PASS (equal)** | ✔ 0 hard, 0 dup | ✔ 0 hard, 0 dup |
| 10k | 2,203,117 | 2,203,117 | **PASS (equal)** | ✔ 0 hard, 0 dup | ✔ 0 hard, 0 dup |

Source: `benchmark-cpsat.json`. Both solvers reach the exact optimum of the
linear objective, so scores are equal. The independent validator reports zero
hard-constraint violations and zero duplicate occupancy for every plan. (At equal
score the baseline assigns a few more employees than CP-SAT — 627 vs 624 at 1k,
9,328 vs 9,279 at 10k — because those extra placements carry zero marginal
objective value; both are optimal and valid.)

### (4) Minimal blocking constraints for every unassigned employee

**PASS.** Every unassigned employee carries the smallest set of hard-constraint
kinds whose joint relaxation would open at least one feasible post
(`feasibility.ts::minimalBlockingConstraints`). The derivation is exact: it was
cross-checked against a full-scan brute force over all positions for 1k/2k/3k/5k
across four seeds with **0 mismatches** (`scripts/verify-mbc.ts`), and the
independent validator re-derives and compares the set for every unassigned
employee in every property-test run and benchmark. Ties among equal-size sets are
broken lexicographically, so the result is independent of scan order.

### (5) Image builds in the repo pattern and passes a CVE scan

**Image: PASS.** The CP-SAT sidecar builds from its own pinned Dockerfile
(`python:3.12-slim-bookworm`, `ortools==9.11.4210`, Apache-2.0) on a **dedicated
buildx builder** that is removed afterwards; image ≈ **376 MB (arm64)**; the
image and builder are removed on exit; the end-to-end smoke test returns the
expected optimum (`docker-cpsat.log`). This is the D-ST-22 pattern (own
Dockerfile / own CI job) in spike form.

**CVE scan: RUN (trivy 0.74.0 on the host), with findings.**
- OS layer (Debian bookworm base): **Total 57 (HIGH 55, CRITICAL 2)** — almost
  all `will_not_fix`/affected base-OS packages (e.g. `zlib1g` CVE-2023-45853
  CRITICAL, `glibc`, `util-linux`, `perl-base`).
- Python layer: **Total 2 (HIGH 2)** — `protobuf 5.26.1` (CVE-2025-4565,
  CVE-2026-0994), both **fixed** upstream (pin ≥ 5.29.6 / 6.33.5).

Raw output: `trivy-cpsat.txt`, `trivy-cpsat.json`. **Recommendation if CP-SAT is
adopted:** use a distroless or `-slim` + patched base, pin `protobuf` to a fixed
version, and gate the image on a `trivy --exit-code 1 --severity HIGH,CRITICAL`
CI step. The current image would **not** pass a strict HIGH/CRITICAL gate without
base-image hardening and the protobuf pin bump; this is a precondition on
adoption, recorded here for the owner.

---

## 3. Timefold — NOT RUN (blocked on D-ST-06)

D-ST-06 (solver licensing/hosting; Community vs Enterprise features; JVM base
images for on-prem / air-gapped NIC-SDC; data residency) is **PROPOSED** and
marked "before M01 spike". Per the ST-M01-13 scope, **Timefold was not built or
run**. Only the adapter interface slot (`TimefoldAdapterSlot` in
`src/SolverPort.ts`) is declared, so the port surface is complete and a Timefold
adapter can be dropped in later without an interface change. **No licence was
accepted, no JVM image was built, no benchmark was run.**

To unblock: owner approval of D-ST-06 (which edition, which features are
Enterprise-only, JVM base-image/air-gap posture, data residency), after which a
JVM sidecar spike mirroring the CP-SAT one would measure Timefold against the same
five thresholds.

---

## 4. Recommendation (data for the D-ST-05 final lock)

- **Keep the TypeScript baseline as the default** (D-ST-05(c)). On arm64 it meets
  every threshold: deterministic replay, zero hard violations, zero duplicate
  occupancy, exact optimum, minimal-blocking diagnosis, and comfortably under the
  per-10k-partition time budget. It has **no JVM, no native binding, no extra
  CVE surface, and no licence question**.
- **CP-SAT is a viable candidate** on functional grounds (equal score, zero
  violations, deterministic per build, builds in the repo pattern) **but adds a
  Python sidecar and a non-trivial CVE surface**. Adopt it only if a future need
  (richer non-linear objectives, larger single partitions) justifies it, and only
  after base-image hardening + the protobuf pin so it passes a strict CVE gate.
- **Timefold:** gather no data until D-ST-06 is approved.
- **Before the final lock:** re-run all timings on **x64** (this host is arm64);
  the determinism and correctness results are architecture-independent (integer
  objective, no floats), but the wall-time thresholds must be confirmed on the
  target architecture.

---

## 5. Acceptance commands

```bash
cd spikes/solver
npm install
npm run typecheck                                   # tsc --noEmit, clean
npm test                                            # 26 property/validator/adapter tests
npm run determinism                                 # baseline 3-run identical hashes
bash scripts/docker-cpsat-build.sh bench-results    # dedicated builder + trivy + smoke; cleans up
node --import tsx src/determinism.ts bench-results/determinism-cpsat.json \
  --cpsat "docker run --rm -i st-m01-13-cpsat:tmp"  # CP-SAT 3-run identical hashes
node --import tsx scripts/bench-cpsat.ts "docker run --rm -i st-m01-13-cpsat:tmp"  # score vs baseline
node --import tsx scripts/bench100k-timed.ts        # 1k/10k/100k baseline timings -> benchmark.json
```
