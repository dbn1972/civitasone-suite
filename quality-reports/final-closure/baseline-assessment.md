# Baseline assessment

## Refresh 2026-10-24 (final defect-closure run)

Scope of this refresh: Run 1 (`~/orch-logs/closure/pass1-result.json`, pass2-*.json) and Run 2 (run2-* files, `~/orch-logs/closure/run2-blocked-approved.json`), the owner-approved release-blocker fixes (#2181, #2182, #2184, #2186-#2188, #2190-#2192), the E2E fixes (#2183, #2185, #2189), and every security PR merged since 2026-10-22. Reports were refreshed on the existing PR #2172 branch `docs/final-closure-reports` after merging `origin/main` (`9d93535e57b686e557cb36d998008a5f9687e1a6`) into it; no force-push.

**Release decision: FAIL.** This is the independent verifier's decision, reproduced exactly. Nothing in this refresh overrides it.

### Baselines

- Run 1: frozen baseline SHA `f82d57053f55237ace2515c8b84398923f3df5f7`; discovery in `discover-1..6.json`, result in `~/orch-logs/closure/pass1-result.json`.
- Run 2: baseline was the then-current origin/main (verifier refers to `53f343019`), about 32 fix PRs after Run 1. Excluded: defects already in Run 1 `confirmedLow`/`blockedForApproval`, items in `deferred-approval.md`, files touched by PRs #2147, #2163, #2175 and #2172. Discovery files: `run2-discover-1.json` (16), `-2` (9), `-3` (12), `-4` (0), `-5` (3), `-6` (13). IDs `CLOS2-S<n>-NN`.
- Final-check baseline for this refresh: main `9d93535e57b686e557cb36d998008a5f9687e1a6`. Guards that failed at the Run 1 baseline and now pass: money-precision (151 findings), secret-scanner (71), sql-injection (24), package-exports (10), per final checks. Caveat: those counts are from the Run 1 baseline records; I did not re-derive them.

---

**Below: the Run 1 record as written on 2026-10-23 (PASS 4). Where the refresh above contradicts it, the refresh wins; the older text is kept as history, not rewritten.**

Frozen baseline SHA: `f82d57053f55237ace2515c8b84398923f3df5f7` (PASS 1 discovery was done against this SHA; it is the merge commit of #2143). During the run origin/main advanced to `cdeb2b09ced7340623f6508936a744d99971c91f` (after #2155 and #2157 merged); PASS 3 compared against that SHA.

Primary checkout at baseline time (from `baseline.json`): branch main at `d8f0bdbdde6b8806d09e533e1a627ec0a4bfe76d`, behind origin/main, with a modified `docs/gap-closure/w0-recount.md`, a modified `docs/gap-ledger/PRIORITY_QUEUE.md`, and untracked `erp-gap-analysis/`, `erp-gap-remediation/`, `refs/`. Baseline runs were made in a separate worktree, not the primary checkout.

## Executed evidence (baseline checks)

| Check | Command | Exit | Result |
|---|---|---|---|
| install | `pnpm install --frozen-lockfile` | 0 | PASS (13s) |
| typecheck | `pnpm turbo typecheck --force --concurrency=4` | 0 | PASS 126/126 tasks, 704s |
| lint | `pnpm turbo lint --concurrency=4` | 0 | PASS 0 errors, 67/67 tasks, 181s (warnings present, not counted) |
| web-vitest | `cd apps/web && npx vitest run --maxWorkers=2` | 0 | PASS: 2292 files, 18414 tests passed, 0 failed, 0 skipped, 2299s |
| web-build | `flock /tmp/civitas-webbuild.lock pnpm --filter @civitasone/web build` | 0 | PASS 482s |
| test:contract | `pnpm test:contract` | 0 | PASS 148 passed, 1 skipped, 15s |
| guards-pass | `node scripts/ci/<guard>.mjs` | 0 | PASS: arch, ci-config, contradictory-badge, datatable-render, deployment-declaration, empty-vs-error, evidence-suite-dbs, flaky-skip, jsx-a11y-ratchet, nested-tx, queue-publish-messageid, raw-session-guc, raw-status-leak, stat-tile-literal, tenant-predicate, tenant-router, tenant-table-rls, test-ledger-poison, authz-tenant-scanner, zero-test-module-scanner, bundle-size (re-run with the web build log) |
| guard-money-precision | `node scripts/ci/money-precision-guard.mjs` | 1 | FAIL at baseline |
| guard-sql-injection | `node scripts/ci/sql-injection-guard.mjs` | 1 | FAIL at baseline |
| guard-secret-scanner | `node scripts/ci/secret-scanner.mjs` | 1 | FAIL at baseline |
| guard-package-exports | `node scripts/ci/package-exports-guard.mjs` | 1 | FAIL, environment artifact |
| guard-schema-drift | `node scripts/ci/schema-drift-guard.mjs` | 1 | NOT VERIFIED: needs a DB. It ran against the shared dev Postgres on :5435 and 9 DBs were missing, so the result is invalid |
| guard-tenant-index | `node scripts/ci/tenant-index-guard.mjs` | 1 | NOT VERIFIED: needs a DB. It ran against :5435, 9 DBs were unreachable, and it reported 61 tenant tables with no leading tenant_id index, which is invalid |

Durations and raw exit codes: `~/orch-logs/closure/baseline-results.txt` (install 13s, typecheck 704s, lint 181s, contract 15s, vitest 2299s, webbuild 482s). Logs: `baseline-install.log`, `baseline-typecheck.log`, `baseline-lint.log`, `baseline-contract.log`, `baseline-vitest.log`, `baseline-webbuild.log`, `baseline-guard-*.log`, all under `~/orch-logs/closure/`.

### Guards

Pass (exit 0): arch, ci-config, contradictory-badge, datatable-render, deployment-declaration, empty-vs-error, evidence-suite-dbs, flaky-skip, jsx-a11y-ratchet, nested-tx, queue-publish-messageid, raw-session-guc, raw-status-leak, stat-tile-literal, tenant-predicate, tenant-router, tenant-table-rls, test-ledger-poison, authz-tenant-scanner, zero-test-module-scanner, bundle-size (passed on rerun with the build log: `baseline-guard-bundle-size-guard-rerun.log`).

Fail at baseline (pre-existing, exit 1):
- money-precision-guard: 151 write-path violations
- sql-injection-guard: 24 patterns (10 HIGH / 14 MEDIUM / 13 LOW as recorded; sampled ones were template-literal event names)
- secret-scanner: 71 potential (sampled ones were field names / test strings)
- package-exports-guard: 10 unresolvable entry points (kms, plugin-sdk, security-headers dist unbuilt; environment artifact, no turbo build run)

### Not verified at baseline

- schema-drift-guard and tenant-index-guard: need a bootstrapped DB; they ran against the shared :5435 with 9 DBs missing, so the results (61 new tables reported, etc.) are INVALID and were not used.
- DB-backed service suites were not run at baseline (per-PR CI and per-fix disposable-DB runs cover them).

## Analysis

- At the frozen baseline the web unit suite was green (18414 passed, 0 failed), typecheck, lint, contract and web build were green, so any later red in those areas is attributable to changes made after `f82d57053f55237ace2515c8b84398923f3df5f7`.
- The four failing guards fail on counts of pre-existing findings; they were treated as the baseline reference (classification (a) in `regression-results.md`). No guard baseline file was modified.
- The baseline is not a clean bill of health: the CVE / SCA gate (Next.js) and container scans are red in CI on main, and DB-dependent guards were never evaluated.

## Discovery scope (executed, PASS 1)

PASS 1 produced 39 confirmed LOW defects, 7 BLOCKED_FOR_APPROVAL, 1 rejected (CLOS-S5-01), 0 unverified (`pass1-result.json`). Areas with open in-flight PRs (#2141 #2142 #2145 #2146 #2148 #2149 #2150 and the rescan-fix lanes) were excluded from discovery by the brief.
