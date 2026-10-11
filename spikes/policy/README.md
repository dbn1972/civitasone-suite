# spikes/policy — ST-M01-14 policy engine spike (D-ST-07)

A throwaway, self-contained spike that evaluates **GoRules ZEN**
(`@gorules/zen-engine@2.1.4`, MIT) against the five D-ST-07 exit criteria.

> **Not production.** This package is deliberately **outside** the pnpm
> workspace (`pnpm-workspace.yaml` covers only `apps/*`, `services/*`,
> `packages/*`). It is not imported by any service, is invisible to the CI
> architecture guards and secret scanner (which scan `services/`, `packages/`,
> `apps/`, `scripts/`, `infra/`), and does not touch `pnpm-lock.yaml`. Install
> and run it in isolation with `npm`.
>
> **All rule packs are SYNTHETIC** (not real policy — real policy is D-ST-15).

See `REPORT.md` for the PASS/FAIL findings and recommendation.

## Run

```bash
cd spikes/policy
npm install                 # isolated; does NOT read pnpm-workspace.yaml

npm run typecheck           # tsc --noEmit
npm test                    # vitest: 13 tests (packs, citations, determinism)

npm run determinism         # 3-run output+trace hashing  -> bench-results/determinism.json
npm run bench               # 100k single-worker benchmark -> bench-results/benchmark.json

# Criterion 2: native binding in node:20.20.2-bookworm-slim + air-gapped install.
# Creates and removes its OWN dedicated buildx builder; removes throwaway images.
bash scripts/docker-native-build.sh bench-results
```

## Layout

| Path | Purpose |
|---|---|
| `src/PolicyEvaluatorPort.ts` | Technology-neutral port (interface). |
| `src/ZenPolicyEvaluator.ts` | ZEN adapter; citation resolution + deterministic hashing. |
| `src/rulepacks.ts` | Three SYNTHETIC JDM packs + citation manifests. |
| `src/generate.ts` | Seeded deterministic synthetic generator (no PII). |
| `src/benchmark.ts` | 100k single-worker benchmark. |
| `src/determinism.ts` | 3-run outputs+traces hashing. |
| `test/evaluator.test.ts` | Vitest suite. |
| `scripts/docker-native-build.sh` | Dedicated-builder Docker native + offline test. |
| `REPORT.md` | D-ST-07 findings, PASS/FAIL, recommendation. |
