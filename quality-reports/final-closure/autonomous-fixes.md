# Autonomous fixes

## Refresh 2026-10-24 (final defect-closure run)

Scope of this refresh: Run 1 (`~/orch-logs/closure/pass1-result.json`, pass2-*.json) and Run 2 (run2-* files, `~/orch-logs/closure/run2-blocked-approved.json`), the owner-approved release-blocker fixes (#2181, #2182, #2184, #2186-#2188, #2190-#2192), the E2E fixes (#2183, #2185, #2189), and every security PR merged since 2026-10-22. Reports were refreshed on the existing PR #2172 branch `docs/final-closure-reports` after merging `origin/main` (`9d93535e57b686e557cb36d998008a5f9687e1a6`) into it; no force-push.

**Release decision: FAIL.** This is the independent verifier's decision, reproduced exactly. Nothing in this refresh overrides it.

### Executed: PRs delivering fixes (states from `gh pr view` at refresh time)

| PR | State | What | Notes |
|---|---|---|---|
| #2154, #2155, #2157, #2165, #2169, #2170 | MERGED (2026-10-22/23) | Run 1 LOW fixes (CLOS-S1..S6) | merge SHAs in `defect-registry.md` |
| #2167 | MERGED | deflake 9 of 11 CI-flaky tests (2 needed a decision) | |
| #2176 (S5), #2177 (S2) | MERGED | Run 2 slices 5 and 2 | |
| #2178 (S6), #2179 (S1), #2180 (S3) | CLOSED, content delivered via #2193 | Run 2 slices 6, 1, 3 | |
| #2181 | CLOSED, delivered via #2193 | delegation validity decided on IST date | owner-approved |
| #2182 | CLOSED, delivered via #2193 | drainage complaint/hotspot numbers from Postgres sequences (DB change) | owner-approved; resolves CLOS-FLAKY-DRAINAGE |
| #2183, #2185, #2189 | CLOSED, delivered via #2193 | E2E spec/mocks fixes (HR leave/transfer; locations, CRM, tenant-admin; curly apostrophe) | no skips per bundle body |
| #2184 | CLOSED, delivered via #2193 | payroll bigint-paise money precision | owner-approved |
| #2186 | CLOSED, delivered via #2193 | CLOS2-S3-01 (XSS), CLOS2-S1-01, CLOS2-S3-03 | security |
| #2187 | CLOSED, delivered via #2193 | CLOS2-S6-02, S6-13, S3-11 (IST dates, no fabricated timestamps) | |
| #2188 | CLOSED, delivered via #2193 | CLOS2-S6-01, S6-06, S6-12 (rate-limit key, storage errors, gov-adapter timeouts) | |
| #2190 | CLOSED, delivered via #2193 | 24 sql-injection-guard findings cleared by code changes | |
| #2191 | CLOSED, delivered via #2193 | money precision outside payroll | |
| #2192 | CLOSED, delivered via #2193 | 71 secret-scanner findings cleared without touching the scanner | see credential-rotation notice |
| **#2193** | **MERGED** 2026-10-23 16:06Z, merge commit `db755f379ffa46e5ba41685f8299701bb6b15e9a` | final release bundle combining the above; each constituent reviewed CLEAN at the merged head (per the PR body) | |

Bundle-level orchestrator fixes in #2193 (from its PR body): #2186 x #2180 conflict in the AI assistant markdown renderer resolved by hand keeping both fixes; the missing `--accent` design token (11 components rendered transparent accents); Next 15 Promise searchParams in 6 new IST tests; a lint-safe sentinel; no raw HTTP status in a thrown message; an awaited race in the OverdueTaskAlerts i18n test. Local checks quoted in that PR body: web vitest 19,853/19,853, tsc clean, lint 0 errors, next build ok, test:contract pass.

Run 2 low-risk fixes (from run2-pass2 records): S1 02-13, 15, 16 (dates via IST helpers, integer parsing, error-vs-empty states, designer error handling); S2 01-08 (HR payroll/holiday/shift/promotion IST clocks, filters); S3 02, 04-10, 12 (blocked storage, network-error copy, notification bell, telephony, CRM export); S5 01-03 (uuid path params to 400/404 instead of 500); S6 03-05, 07-11 (circuit-breaker half-open, search res.ok, quota cache parse, roster parse, turnstile, carrier timeout, pkce). Not fixed with evidence: **CLOS2-S1-14** (NotificationsPanel raw "Failed to fetch"; LOW, no PASS 2 record found); **CLOS2-S2-09** (leave policy empty field saved as 0; BLOCKED_FOR_APPROVAL).

### Not executed / analysis

- I did not re-run each fix's regression test in this refresh; the evidence is the fixer's recorded before/after and the verifier's spot-checks listed in `release-readiness.md`.
- Nothing is marked VERIFIED except what the verifier itself re-ran.

---

**Below: the Run 1 record as written on 2026-10-23 (PASS 4). Where the refresh above contradicts it, the refresh wins; the older text is kept as history, not rewritten.**

Scope rule (`~/orch/closure-brief.md`): LOW-RISK defects only; everything else goes to `deferred-approval-items.md`. Agents never merged and never pushed to main; merging was done by the orchestrator.

## Executed: what was fixed, by PR

| PR | State | Head / merge SHA | Defects | CI summary |
|---|---|---|---|---|
| #2155 `fix/closure-designer` | MERGED 2026-10-22T22:18:07Z | merge `c1e2138071564240f9e9fa94f8987423836495f5` | CLOS-S1-01..04 | 25 pass; red: CVE / SCA Gate, Coverage Gate, E2E (Playwright) |
| #2157 `fix/closure-web-modules` | MERGED 2026-10-22T23:36:20Z | merge `cdeb2b09ced7340623f6508936a744d99971c91f` | CLOS-S1-13..16, S2-01..06 | 22 pass; red: CVE / SCA Gate, Tests, E2E (Playwright) |
| #2154 `fix/closure-citizen-web` | OPEN | head `dc3941fda0fcef89c95387ad0c858c8ac4325bcc` | CLOS-S1-05..12 | 19 pass; 6 red (CVE/SCA, Tests, 3x Trivy, E2E) |
| #2165 `fix/closure-web-shared` | OPEN | head `4e24678cb7f3e8c5580859accc9a71df8c39665a` | CLOS-S3-01..06 | same 6 red |
| #2169 `fix/closure-services-a-v2` | OPEN | head `3121310c8c313b754399eb8ec638d3f8c223fd9f` | CLOS-S4-01..03, S5-02..04 | same 6 red |
| #2170 `fix/closure-services-b-v2` | OPEN | head `ee978a6f314a56eadf01250b6b046fbfbb28aa27` | CLOS-S6-01,03,04,05,08 | same 6 red |
| #2167 `fix/closure-flaky-tests` | OPEN | head `076657557349783989ffed40bacd2719067460a9` | 9 of 11 CI-flaky tests deflaked | same 6 red |

#2162 (services-a) and #2168 (services-b) were CLOSED and superseded by #2169 and #2170 (v2). The v1 services-b head recorded in `pass2-services-b.json` is `cd0795f06535cacc322fabe064a50d76506dd1b6`.

The 6 red jobs on the open PRs (CVE / SCA Gate, Tests, 3x Trivy Container Scan, E2E) are the same set and PASS 3 attributes them to baseline causes (Next.js CVE, auditResource.test.ts, 19 E2E specs failing identically on main). That is analysis from PASS 3, not a per-PR re-derivation.

## Executed: before/after evidence per fix

Every fix has a regression test that failed before the change and passed after, as recorded by the fixing agent. Full per-defect detail (root cause, file, fix, test, before, after) is in `defect-registry.md`. Summary of the evidence classes:

- CLOS-S1-05..12 (#2154): 8 new `*.network.test.tsx` suites; before: raw 'Failed to fetch' shown, polling continued after unmount (expected 6 to be 2); after: all pass.
- CLOS-S1-01..04 (#2155): retry-success, non-OK fetch throws, offline copy tests; before/after recorded.
- CLOS-S1-13..S2-06 (#2157): IST date defaults, timer cleanup, error mapping, abort guards, null instead of fabricated 'now'. Example before: 'expected 2026-10-21 to be 2026-10-22'.
- CLOS-S3-01..06 (#2165): IST boundary tests, aria-label query, xhrPut abort/listener, FileUpload interval cleanup, DataSourceBadge IST.
- CLOS-S4-01..03, S5-02..04 (#2169): service route tests (folder uuid 4 failed to 5/5 pass; templates 5 failed to 7/7; court overdue 4 failed to 5/5; hrms limit params; legal hearing-reminder stop 4 failed to 4/4). Full-suite counts recorded: document 406 passed, contract 484, court 696, hrms 6916, legal 383.
- CLOS-S6-01,03,04,05,08 (#2170): revenue 8 failed to 8 passed (suite 645/645); rate-head-id 3 failed to 6 passed; works 3 failed to 6 passed (suite 643/643); outbox purge failure log (suite 58 passed); schemas http-error-handler (no test existed; 16 passed).
- #2167: flake rates before/after in `defect-registry.md`.

## Not executed / not re-checked (analysis)

- The PASS 4 verifier did not run regression tests for 8 distinct FIXED defects and did not read the per-defect diffs.
- PASS 3 ran only service suites for services touched by the integrated diff, and did not run package suites (`schemas`, `outbox`) locally; the CI Tests job covers them and was red for other reasons, so it is not clean evidence for those packages.
- Test-weakening scan by the verifier: no deleted test files and no new `.skip` / `.only` / `.todo`. Three test files lost `expect()` lines (all under `apps/web/src/app/(app)`): `finance/expenditure/advances/new/page.test.tsx` (12 tests to 2, with a new `NewAdvanceForm.test.tsx` of 24 `it`s, commits `0ede15adf`, `3e7600a7f`), `hr/promotion/PromoteWithApproval.lookups.test.tsx`, `procurement/orders/new/CreatePOForm.test.tsx`. They appear moved, not dropped, but not checked one by one. The analytics ml-insights tests were rewritten (old 'Stale' / 'last trained' assertions replaced by 'does not render fields ml-service never emits'): a behaviour change, not a clean low-risk test fix. These belong to PRs outside this closure's own fix set (#2166, #2156 area).

## Rule conformance notes

- One breach disclosed by a lane agent (#2153): it used one `pkill -f` pattern limited to its own `timeout 1500 npx vitest` command to stop a hung test run, against the no-pattern-kill rule. It reported no other process affected; ec2-user is shared. Recorded in `owner-questions-lanes.md`.
- No guard baselines were added by the closure PRs (per the fixers' reports; not independently grepped by me for this report).

## Recommendations (not executed)

1. Review the response-status-changing fixes (S4-01, S4-02, S6-01, S6-04) against the 'no API contract change' criterion before merging #2169 / #2170.
2. Fix P3-NEW-1 (raw status in thrown Error) and P3-BASE-1 (`medical_employee_record`) first: both are one-line, low-risk, and gate the Architecture Guard and Tests jobs.
