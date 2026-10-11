# ST-M01-14 — Policy engine spike report (D-ST-07)

**Spec:** §6 (Government Policy Studio), §16 (testing & independent verification).
**Decision gathered for:** D-ST-07 (PROPOSED — policy/rule engine). This spike
collects data; the adoption decision stays the owner's (Chief Architect with
policy SME).
**Branch:** `st/m01-14-policy-spike`. **Location:** `spikes/policy/` — a
self-contained package that is **not** a pnpm-workspace member and is **not**
imported by any production service. It does not touch `pnpm-lock.yaml`, turbo
builds, or the CI architecture guards (all of which scan only
`services/`, `packages/`, `apps/`, `scripts/`, `infra/`).

> ⚠️ **All rule packs are SYNTHETIC.** They are invented placeholders used only
> to exercise the engine, trace and citation path. Real transfer policy, its
> GO/notification references and legal citations are **D-ST-15** (INFORMATION
> REQUEST, not supplied). Every pack sets `synthetic: true`; every id is
> `SYN-`-prefixed.

## Candidate

- Package: **`@gorules/zen-engine`**, pinned **`2.1.4`** (exact).
- Engine: GoRules ZEN, a Rust Business Rules Engine with napi-rs Node bindings.
- Distribution: a thin JS package plus **prebuilt** per-platform native binaries
  shipped as `optionalDependencies` (`@gorules/zen-engine-<platform>@2.1.4`).
  There is **no node-gyp / Rust-toolchain source build**; "native binding builds"
  reduces to "the correct prebuilt binary resolves and loads". For
  `node:20.20.2-bookworm-slim` (glibc Linux) the relevant packages are
  `@gorules/zen-engine-linux-x64-gnu` (typical prod) and
  `@gorules/zen-engine-linux-arm64-gnu` (this host).
- Integrity (npm registry, verified `npm view`):
  - `dist.shasum = 36854b8fad28b5c8ef770972d90645ec7174802c`
  - `dist.integrity = sha512-fGO3p9YhChxZvK8aVNDoO9TVUrz+BhGtKyzuUAbWEZhQ7NFm/CzfoYQoca2YINfZTGRPi57APSq/BDNfX8IbdQ==`

## Result summary

| # | D-ST-07 exit criterion | Result | Evidence |
|---|---|---|---|
| 1 | Licence approved by legal | **PENDING LEGAL** (facts recorded; not a builder/engineering call) | §1 below |
| 2 | Native binding builds in bookworm-slim **and** an air-gapped install | **PASS** | `bench-results/docker-online.log`, `bench-results/docker-offline.log` |
| 3 | 100k-employee eval of one rule pack ≤ 10 min on one worker | **PASS** (14.5 s) | `bench-results/benchmark.json` |
| 4 | Identical outputs **and** traces on identical inputs across 3 runs | **PASS** | `bench-results/determinism.json`, test suite |
| 5 | Per-decision rule id and citation available in the trace | **PASS** | test suite, `src/ZenPolicyEvaluator.ts` |

D-ST-07's exit test says "ZEN fails, and the fallback is taken, if **any** of"
the five conditions hold. Only (1) is open, and it is a legal determination, not
an engineering failure. **On the four engineering criteria, ZEN passes.**

---

## 1. Licence (PENDING LEGAL)

Recorded verbatim; approval is legal's, not the builder's.

- **npm `license` field** (`npm view @gorules/zen-engine@2.1.4 license`): `MIT`.
- **Repository LICENSE** (`https://raw.githubusercontent.com/gorules/zen/master/LICENSE`,
  and the `LICENSE` inside the published tarball): the MIT License text, verbatim:

  > Copyright 2023 GoRules.io
  >
  > Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation files (the "Software"), to deal in the Software without restriction, including without limitation the rights to use, copy, modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the Software is furnished to do so, subject to the following conditions:
  >
  > The above copyright notice and this permission notice shall be included in all copies or substantial portions of the Software.
  >
  > THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.

  Source: GitHub `gorules/zen@master:/LICENSE` and `package/LICENSE` in
  `@gorules/zen-engine@2.1.4` (bytes identical).
- **Per-platform native packages** (`@gorules/zen-engine-linux-*-gnu` etc.) are
  published by the same vendor at the same version; the README's licence badge
  and footer both state MIT. Legal should confirm each `optionalDependency`
  tarball's own LICENSE at the pinned version as part of sign-off.
- **Vendor platform note (not a licence fact, flagged for legal/architecture):**
  the open-source engine is MIT, but GoRules also sells a managed/BRMS platform.
  Nothing in this spike uses the paid platform; the embedded engine is the MIT
  OSS core only. Legal should still note the dual OSS/commercial posture.

**Status: PENDING LEGAL.** No engineering blocker found.

## 2. Native binding + air-gapped install (PASS)

Executed by `scripts/docker-native-build.sh`, which creates a **dedicated**
buildx builder (`st-m01-14-policy-<pid>`), uses it, and removes it on exit (the
host default builder is never touched; no bulk prune).

- **Stage A — online, exact prod base.** `node:20.20.2-bookworm-slim`,
  `npm install @gorules/zen-engine@2.1.4`, then load the binding and evaluate.
  Output: `NATIVE_SMOKE {"node":"v20.20.2","arch":"arm64","result":{"eligible":true},"ok":true}`
  (`bench-results/docker-online.log`).
- **Stage B — air-gapped.** The engine tarball and its platform-binary tarball
  are `npm pack`-ed on the host into a `vendor/` dir, copied into the build
  context, and installed inside the image **with `--network=none`** (BuildKit)
  and `npm install --offline` against an unreachable registry. The binding loads
  and evaluates identically: `NATIVE_SMOKE {"node":"v20.20.2","arch":"arm64","result":{"eligible":true},"ok":true}`
  (`bench-results/docker-offline.log`).

**Honest caveats:**
- The build host is **arm64**, so the stages exercised `linux-arm64-gnu`. The
  mechanism (prebuilt-binary resolution + offline tarball install) is
  arch-independent, but a production **x64** target must be re-run against
  `@gorules/zen-engine-linux-x64-gnu` before final lock. This is a one-line arch
  substitution in the script.
- The offline path requires the platform binary tarball to be vendored
  explicitly. In an air-gapped deployment the ops runbook must mirror both
  `@gorules/zen-engine` **and** the matching `@gorules/zen-engine-linux-<arch>-gnu`
  into the private registry / vendor store. Documented here so it is not a
  surprise at deploy time.

## 3. 100k-employee throughput on one worker (PASS)

`src/benchmark.ts`, single-threaded (one evaluator, one `await` loop, no
`worker_threads`, no fan-out). Seeded synthetic generator (`src/generate.ts`,
`mulberry32`), no real PII.

- Pack: `syn-min-tenure`. Count: 100,000. Seed: 20261009.
- **Elapsed: 14,465 ms (≈14.5 s)** against a **600,000 ms** (10-minute) threshold.
- Throughput: **6,913 evaluations/second** on one worker.
- Full record: `bench-results/benchmark.json` (includes node/arch/platform and
  spot-check decision hashes at indices 0 / 50000 / 99999).

Caveat: measured on host node **v22 / arm64**. The in-container smoke (criterion
2) confirms the binding runs on node 20.20.2; a formal 100k run inside the
bookworm-slim x64 image is recommended at final lock for an apples-to-apples
production number. Given a 41× margin to the threshold, the risk of missing it
on the prod base is negligible, but the number is honestly a host-node figure.

## 4. Determinism — outputs AND traces (PASS)

`src/determinism.ts`, 3 runs over all three packs on a fixed seeded sample.

- For every pack, the SHA-256 over the ordered outputs is identical across all 3
  runs, and the SHA-256 over the ordered **citation traces** is identical across
  all 3 runs.
- `bench-results/determinism.json`: `allPass: true`; each pack
  `outputsIdentical: true`, `tracesIdentical: true`.
- The port also exposes a `decisionHash` (SHA-256 over canonicalised
  output + citation trace, **excluding** ZEN's wall-clock `performance` strings),
  which is stable across separate evaluator instances (test:
  "decisionHash is stable across evaluator instances").

This satisfies the allocation engine's replay contract (spec §7.3): same inputs
+ same pack hash → same plan hash.

## 5. Per-decision rule id + citation in trace (PASS)

ZEN's trace is `Record<nodeId, { id, name, input, output, order, traceData }>`.
For decision-table nodes, `traceData.rule._id` carries the fired rule's id. The
adapter (`src/ZenPolicyEvaluator.ts`) resolves that id against the pack's
citation manifest and emits a `PolicyTraceEntry` with `ruleId` **and** a
`PolicyCitation` carrying the spec §6 traceability fields (policy id, GO
reference, issuing authority, clause, effective date). Test
"every decision table node exposes a ruleId and a resolved citation" asserts
this for a concrete evaluation; the determinism report asserts
`everyDecisionHasRuleId` and `everyDecisionHasCitation` for every record in the
sample across all packs.

---

## Deliverables in this spike

- `src/PolicyEvaluatorPort.ts` — the technology-neutral port (interface).
- `src/ZenPolicyEvaluator.ts` — the ZEN adapter + deterministic hashing.
- `src/rulepacks.ts` — three SYNTHETIC JDM packs (min tenure, sensitive-post
  rotation, spouse/medical priority) with citation manifests.
- `src/generate.ts` — seeded deterministic synthetic generator (no PII).
- `src/benchmark.ts` — 100k single-worker benchmark → `benchmark.json`.
- `src/determinism.ts` — 3-run output+trace hashing → `determinism.json`.
- `test/evaluator.test.ts` — 13 tests (packs, citations, determinism, generator).
- `scripts/docker-native-build.sh` — dedicated-builder Docker native + offline test.

## Recommendation (data only; decision is the owner's)

On the four engineering criteria of D-ST-07, **GoRules ZEN 2.1.4 passes
decisively**: it loads on the exact prod base and under a fully air-gapped
install, evaluates 100k records in ~14.5 s (41× under budget) on one worker, is
byte-identical in outputs **and** traces across runs, and surfaces a per-decision
rule id with a full citation. The spike therefore supports option **(a)** of
D-ST-07 (ZEN embedded in `smarttransfer-service`, behind `PolicyEvaluatorPort`,
with versioned/signed rule packs) over the `dmn`/in-house fallbacks — **subject
to the two owner-only gates that remain open and are out of a builder's hands:**

1. **Legal sign-off on the MIT licence** of the engine and every per-platform
   `optionalDependency` tarball at the pinned version (criterion 1 is PENDING
   LEGAL).
2. **D-ST-15 real policy documents.** Every pack here is synthetic; no real
   rule, tenure, rotation, sensitive-post, spouse, medical or hardship logic can
   be authored or regression-tested until the authoritative policy and its legal
   citations are supplied.

Suggested follow-ups before final lock (not blockers for the data): re-run
criteria 2 and 3 against the production **x64** bookworm-slim image; and have ops
confirm the private-registry mirroring of both the engine and its platform-binary
package for air-gapped deployments.

**STOP_AND_ASK items for the owner** (recorded, not resolved here): legal licence
approval (D-ST-07 criterion 1) and the D-ST-15 policy documents + named policy
SME. Neither is a builder decision; both are pre-existing owner gates, so this
spike delivers its data and does not block on them.
