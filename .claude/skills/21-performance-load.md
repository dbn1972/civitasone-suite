# Skill — Performance / Load

**When to load:** Before claiming a service is "production ready" on performance grounds, when writing a query inside a loop, touching cache invalidation, or reviewing any claim about throughput/latency at scale — this skill covers what skill 16 does not (skill 16's own "Known gaps" names this explicitly: "no throughput, latency percentiles, or degradation under realistic production traffic").

---

## The rule

> Every SLO, index, and cache in this platform has been validated against toy data volume or none at all. Treat any performance claim — including the ones in this skill — as unverified at real production scale until a real load test says otherwise, because no load test has ever been run.

## 1. There is no load-testing infrastructure at all

For a platform whose own operations documentation targets **1,000 TPS sustained, 10M users**, there is zero load-testing tooling anywhere in the repo — no k6, Artillery, autocannon, or Locust config, in any service's `package.json` or anywhere else. Every SLO/SLI number that exists (§2) is measured from **production/staging observability only**, never validated pre-production under synthetic load. **Before trusting any latency or throughput claim about this platform, ask whether it was load-tested or just observed under whatever real traffic happened to exist at the time** — right now, the honest answer is always the latter.

## 2. The SLO/SLI targets that exist, and their real measurement gap

`docs/operations/SLO-SLI-RUNBOOKS.md` defines real targets: availability 99.9% (99.95% for enterprise tenants), p95 interactive read 300–500ms, **p95 auth/session validation < 150ms**, p95 list/search < 2s, RPO ≤ 15min, RTO ≤ 4h, a 30-day error-budget window, and per-service targets for Tier-0/1 services (gateway proxy overhead < 50ms p95, identity token-validate < 150ms, queue publish < 100ms). It correctly notes the CQRS write-path nuance: since writes go through a queue, **the meaningful write SLI is command-processing latency (publish → consumer commit) and queue lag, not HTTP write latency** — don't benchmark a write endpoint's HTTP response time and call it the write SLO.

SLIs are collected live via `registerOpsRoutes` (`http_request_duration_ms` histogram) across all ~33 services, with per-tenant noisy-neighbor counters. `docs/OPERATIONS_DASHBOARD_RUNBOOK.md` self-discloses a real gap in even this observability: most schedulers run via durable `setInterval` loops inside workers but don't all write to a shared `job_runs` table, so the operations dashboard "can show scheduler owner health but not a verified last successful run for every scheduler." **A green ops dashboard does not currently mean every scheduled job actually ran successfully** — verify a specific scheduler's own logs if that matters for the question at hand.

## 3. The N+1 query bug class — including a documented "the audit said clean, and it wasn't"

A live, uncorrected N+1 exists in `services/grant-service/src/modules/disbursement/repo.ts`'s `findDisbursementsByApplicationId`: it loops over installment IDs and issues one query per installment, even though `inArray` is imported in the same file and used correctly elsewhere in it (a sibling function, `sumDisbursedForApplication`, is commented as deliberately using `SUM()` aggregation "safe at any data volume" — the team clearly knows the right pattern, it just wasn't applied here).

More importantly: a documented performance audit (commit `4e48b452`) explicitly claimed **"0 N+1 query patterns in consumers"** as part of an 8.5/10 rating. A later commit (`bcf0980c`) found and fixed three real ones in finance-service that the earlier audit had missed (`findBillsByIds`/`findHeadsByIds` batch loaders eliminating N+1 in `listPayments`/`listBudgetSummaries`/`listSanctionSummaries`). **Treat "we audited for N+1 and found none" the same way skill 16 treats a scanner's own blind spots — as evidence of what the audit's method could see, not proof the codebase is clean.** The same July audit also self-flagged `pg_stat_statements` was never enabled ("can't detect slow queries") and that current query plans use sequential scans, which it correctly notes is "correct optimizer behavior for <500 rows" — meaning the database has essentially never been exercised at real production row counts.

## 4. Caching — a genuinely good bounded-TTL design, with a real recurring failure mode around it

`packages/cache/src/index.ts`'s `CacheStore` interface is deliberately designed so a missed invalidation self-heals: every entry has a hard-capped TTL band (`MIN_TTL_SECONDS=1`, `MAX_TTL_SECONDS=3600`), so "the maximum staleness window is never larger than `MAX_TTL_SECONDS`" by construction. `incr` is intentionally kept separate from `getOrLoad`+`put` because the latter coalesces concurrent cold-key callers onto one shared promise — correct for read-heavy caching, unsafe for a rate-limiter/quota counter under concurrency (this is exactly the bug that motivated `incr`'s addition, documented in `packages/cache/CHANGELOG.md` — see skill 17 §2). This bounded-TTL-by-construction pattern is worth copying for any new cache use: **never introduce a cache entry with no TTL cap, reasoning that "invalidation will handle it" — invalidation is exactly the thing that's failed here before**, evidenced by at least five separate real, fixed stale-cache-invalidation bugs across different services (roadcut, fire-service, hrms cache-invalidation mocks, animal-service complaint/registration writes, and others).

## 5. Indexing — a healthy baseline, heavily caveated by data volume

A real, applied fix added composite `tenant_id + status` indexes on finance's bills/payments/journals tables, 7 new FK constraints, and dropped redundant single-column indexes made obsolete by the new composites. A separate audit reported zero tables missing a `tenant_id` index and zero unused indexes at the time. **All of this was measured at under 500 rows per table** (§3) — a healthy index shape today says nothing about whether it's the right shape at real production volume, and no query plan in this codebase has been checked against anything resembling that volume.

## 6. Frontend bundle and load performance

`apps/web/next.config.js` has no bundle-analyzer, code-splitting, or image-optimization configuration for an app with ~2,945 `.tsx` files and 827 pages — its only non-default settings are security headers, the `next-intl` plugin, legacy route redirects, and an `outputFileTracing: false` workaround for an unrelated Next.js bug, not a performance choice. Lighthouse CI exists and runs, but treat it as coverage of whatever specific pages it's configured to check, not a systemic guarantee about bundle size or load time across all 827 pages — confirm which pages a Lighthouse run actually covers before citing it as evidence for a page it may never have touched.

## Forbidden patterns

- A query inside a `for`/`map` loop that could be a single `inArray`/join query, added without checking whether a batch-loader helper already exists in the same file (as it did in the grant-service example above).
- Claiming "no N+1 patterns" or "clean performance audit" as a permanent fact rather than a snapshot bounded by what that specific audit's method could see.
- A new cache entry with no TTL, or a TTL outside the enforced `MIN_TTL_SECONDS`/`MAX_TTL_SECONDS` band.
- Citing a Lighthouse/CI performance check as covering a page it wasn't actually configured to test.
- Treating a latency/throughput number from production observability as proof of the platform's behavior under the SLO doc's own stated target load (1,000 TPS / 10M users) — it is not, until load-tested.

## Known gaps — not covered by this skill

- **No load-testing tool or process exists anywhere in this repo** (§1) — this is the headline gap; every other section here is downstream of not being able to validate anything under synthetic load.
- **No query plan or index has been validated at production data volume** (§3, §5) — everything measured so far is at toy scale (<500 rows/table).
- **Scheduler health is not fully observable** (§2) — the ops dashboard cannot currently verify every scheduled job's last successful run.
- **Frontend performance at the scale of 827 real pages is unmeasured** beyond whatever specific screens Lighthouse CI happens to cover (§6).
- See `.claude/skills/16-production-readiness-audit.md`'s own "Known gaps" for the adjacent, already-named absence of "performance/load testing at production scale" and "resilience/chaos testing" — this skill is the detailed version of that same self-admitted gap.
