# Human Review Backlog — Gap-Ledger Remediation (Wave 4)

**Generated:** 2026-10-07
**Updated:** 2026-10-07 — see "Resolution status" at the top of each section. A follow-up PR closed every item that was safely code-fixable without a new business decision; see the summary table below.
**Scope:** All 55 gap-ledger modules closed across PRs #1874–#1922 (Wave 4), covering 4,644 tracked gap items (1,204 HIGH, 2,196 MEDIUM, 1,244 LOW).
**Status as of writing:** 4,509 items fixed/verified; 55 items left `[~]` partial pending one of the decisions below; 0 modules untouched.

This document consolidates every "Needs human review" and "Left open" note surfaced across the Wave 4 PRs into one place, grouped by risk/urgency, each with a concrete recommendation. It is meant to be triaged once and either closed out (decision made → file a follow-up PR) or converted into tracked issues.

## Resolution summary (as of the 2026-10-07 follow-up PR)

| # | Item | Status |
|---|---|---|
| 1a | `ENABLE_DEV_LOGIN` never `true` in a real deploy config | ✅ **Verified safe** — appears as `true` only in CI test-run env blocks (throwaway servers); `ecosystem.config.js` (real deploy) defaults it to empty/off |
| 1b | `ENABLE_SANDBOX` never `true` in a real deploy config | ✅ **Verified safe** — same fail-closed pattern, absent from `ecosystem.config.js` entirely |
| 1c | Court DSC/eSign PKI integration | ⏳ **Still open** — tracked as a dedicated follow-up project, not a quick fix (see section 1) |
| 1d | Estab quarter vacate/cancel payroll impact; DSC copy legal review | ⏳ **Still open** — needs payroll/legal sign-off, not a code change |
| 2a | `settings`/theme-service `tenant_admin` role mismatch | ✅ **Fixed** — server `ADMIN_ROLES`/`ROLES` now include `tenant_admin` to match the UI gate |
| 2b | `plugins` marketplace-install role mismatch | ⏳ **Still open** — the UI code only exists in the still-unmerged PR #1922; flagged via a review comment on that PR with the exact fix, rather than pushing a direct commit to someone else's in-review branch |
| 2c | `recommendations`/`developer-portal`/`library` new role gates | ⏳ **Still open** — needs a one-time confirmation against production role assignments (low risk; fail-closed by construction) |
| 3 | Money/financial calculation items (contracts, analytics KPI, pricing, catalogue bundles) | ⏳ **Still open** — all require a business/finance/product decision, not a code fix; see section 3 |
| 4 | `ModuleListTable` → `DataTable` shared migration | ⏳ **Still open by design** — this document's own recommendation is to do it as one dedicated PR, not a side effect of a backlog cleanup |
| 5 | Missing backend endpoints (workflow/change actor names, municipal workflow actions, journeys activate UI, domains backend, setup skip-persistence) | ⏳ **Still open** — all are net-new features/endpoints, out of scope for a "close the backlog" pass |
| 6 | Honest-copy/scope-narrowing decisions | ✅ **No action needed** — reviewed and agreed each call was correct |
| 7a | Duplicate migration numbers: `tenant-service` 0015 | ✅ **Fixed** — renamed to `0027_placement_policy.sql` |
| 7b | Duplicate migration numbers: `report-service` 0016 | ✅ **Fixed** — renamed to `0019_template_watermark_pii.sql` |
| 7c | Duplicate migration numbers: `workflow-service` 0004/0012 | ✅ **No action needed** — confirmed a false positive (`0012` and `0012b` are distinct filenames, not a real collision) |
| 7d | Failing `org-hierarchy` reparent test | ✅ **Fixed** — root cause found and fixed (see section 7) |
| 7e | `RunQueryForm` `operator`/`op` contract mismatch | ✅ **Fixed** — web now sends `op`, matching the server schema |
| 7f | Document-service bulk-scan test failures | ✅ **Fixed (environment-only)** — applied the missing migrations to the shared test DB; not part of this PR (DB-state fix, no code change) |

---


> **PR bundling note:** the repository owner is squashing groups of these PRs into combined PRs (`chore: combined gap PR N/4`). As of writing: #1923 (covers former #1885–1894) and #1924 (covers former #1895–1904) are merged; #1916 (1874–1884) and #1925 (1905–1915) are open; #1917–#1922 (change/contracts/documents/inspection/metadata/plugins) are standalone. The PR numbers below refer to the **original per-module PRs** where the decision was recorded — use `git log --grep=GAP-<ID>` or the module's gap-ledger file to find the current location of the change if a PR number below has since been superseded.

---

## 1. Security / production-safety — verify before next prod deploy

| Source | Decision needed | Status / Recommendation |
|---|---|---|
| `auth` (orig. #1899) | Confirm `ENABLE_DEV_LOGIN` is unset in every staging/prod config; the shared dev-login password must live only in an untracked `.env`, never in docs/CI configs in cleartext. | ✅ **Verified safe (2026-10-07).** `ENABLE_DEV_LOGIN: 'true'` appears only inside `.github/workflows/ci.yml` and `nightly.yml`'s throwaway-test-server env blocks (a11y/Lighthouse CI jobs). `ecosystem.config.js` (the real PM2 deploy config) sets `ENABLE_DEV_LOGIN: process.env.ENABLE_DEV_LOGIN ?? ""` — off by default, opt-in only. No `.env.example` sets it. No code change needed. |
| `sandbox` (orig. #1912) | Confirm the demo tenant contains no real data and no live side effects (email/payment); confirm `ENABLE_SANDBOX` is never `true` in production. | ✅ **Verified safe (2026-10-07).** The route (still in the unmerged PR #1912) reads `process.env.ENABLE_SANDBOX === "true"` — fail-closed, same pattern as dev-login. It is absent from `ecosystem.config.js` and every `.env.example`, so it is off by default in any real deploy unless an operator explicitly sets it. No code change needed. Still open: confirming the demo tenant's data/side-effect posture is a product/ops task, not something verifiable from source alone. |
| `court` (orig. #1893) | Judicial order DSC signing is still a pasted blob with structural (not cryptographic) validation. Real signer-token/eSign integration and server-side certificate verification are outstanding. | ⏳ **Still open.** Not a merge blocker — track as a dedicated PKI integration project. Judicial order issuance is legally sensitive; don't rush this into a quick fix cycle. |
| `estab` (orig. #1874) | Quarter vacate/cancel actions affect licence-fee payroll deductions; DSC signature copy needs legal wording sign-off. | ⏳ **Still open.** Confirm with payroll/legal before the next payroll cycle runs. Low risk to merge the code now. |

## 2. Authorization gaps — UI/server role-list mismatches

None of these are exploitable (the server is always the authoritative gate), but they cause confusing 403s or let the UI loosen/tighten the wrong direction.

| Source | Mismatch | Status / Recommendation |
|---|---|---|
| `settings` (orig. #1906) | UI role gate admits `tenant_admin` for branding; theme-service's server-side `ADMIN_ROLES` does not — a tenant_admin sees Save enabled, then gets a 403. | ✅ **Fixed (2026-10-07).** `services/theme-service/src/modules/branding/routes.ts`'s `ROLES` now includes `tenant_admin`, matching the UI. Added a positive test (`tests/routes-rbac-deep.test.ts`) asserting `202` for a `tenant_admin` PUT. 97 tests pass. |
| `plugins` (orig. #1922) | `plugin_admin` sees the Marketplace Install button, but server install is restricted to `super_admin`/`platform_admin` only. | ⏳ **Still open.** This UI only exists in the still-unmerged PR #1922, not on `main` — pushing a direct commit to someone else's in-review branch risked conflicting with the owner's review workflow, so this was flagged with the exact fix via a PR review comment instead (split into a dedicated `PLUGIN_MARKETPLACE_INSTALL_ROLES` constant). Apply when that PR is next touched. |
| `recommendations`, `developer-portal`, `library` (orig. #1898, #1910, #1914) | New web role gates were added, mirrored or inferred from server roles without a direct cross-check in every case. | ⏳ **Still open.** Confirm each gate against actual production role assignments. Worst case if wrong is over-restrictive (fail-closed), not a security hole — low priority but should be checked once. |

**Recommendation for this whole bucket:** batch into a single role-audit follow-up PR rather than reopening each PR individually.

## 3. Money / financial calculations

| Source | Item | Recommendation |
|---|---|---|
| `contracts` (orig. #1918) | Bond-amount conversion now uses string-based paise math and **rejects** sub-paise input instead of silently rounding it. | **Accept the stricter behaviour.** Silent rounding of money is worse than a validation error; officers can re-enter the correct amount. |
| `contracts` (orig. #1918) | Performance-security dates are now real officer-entered dates, replacing synthetic placeholders. | **Accept.** Quick-check whether any report/job depended on the old synthetic date range before merge; if none found, this is a pure correctness fix. |
| `analytics` (orig. #1875) | KPI value/target/status tiles were removed because the backend only returns `"—"` placeholder strings — the *old* UI was computing a false "On Target / Improving" status from string heuristics with no real numeric data. | **Prioritize this.** The old behavior was a genuine executive-dashboard bug (confirmed false positives). Either the KPI module needs real `value`/`target`/`direction` fields from the backend, or the KPI tile should be removed from the product. Don't leave it half-built. |
| `catalogue` (orig. #1890) | Bundle price/validity fields don't exist in the catalogue-service schema. | Add the columns if bundles are meant to be priced/time-boxed; otherwise mark the gap item "not applicable" and close it. Low urgency. |
| `pricing` (orig. #1907) | ₹15,000/month PSU price and the 15% discount figure are static marketing copy pending finance confirmation. | Get finance sign-off on the actual number before this customer-facing page goes live. Not computed money, just needs a business check. |
| `reports`, `loyalty` (orig. #1884, #1896) | MIS values are rupees not paise; loyalty points are plain integers not paise. | No action needed — confirmed this is intentional, not a missed paise conversion. |

## 4. Shared-component / architecture decision — the `ModuleListTable` cluster

Independently deferred in **four** PRs (`tenant` #1876, `install` #1886, `themes` #1889, `catalogue` #1890): swapping the shared hand-rolled `ModuleListTable` for the DS `DataTable` component. All four cite the same reason — it's used by roughly 65 pages across the app, and a blind swap under concurrent editing is a regression risk.

**Recommendation:** do this as **one deliberate, dedicated PR**, not as a side effect of four separate gap-fix PRs.
1. Audit all ~65 consumers of `ModuleListTable`.
2. Migrate to `DataTable` in one atomic PR with full visual-regression coverage (search, sort, pagination, mobile card view).
3. Go back and close the ~15 LOW-severity gap items across tenant/install/themes/catalogue that reference this in one follow-up sweep.

This is the single highest-value piece of consolidated follow-up work from the whole Wave 4 run.

## 5. Backend endpoints that don't exist yet (feature gaps, not bugs)

| Source | Missing capability | Recommendation |
|---|---|---|
| `workflow`, `change` (orig. #1885, #1917) | No way to resolve an actor/assignee user id to a display name — the identity directory lookup is admin-gated. | **Add one centralized, non-admin, tenant-scoped "resolve user id → display name" endpoint.** Closes an audit-readability gap in at least two modules at once; high leverage for the effort. |
| `inspection` (orig. #1920) | No cross-service search endpoint for inspector/entity — assignment create still takes raw UUIDs (now at least validated). | Lower priority. Validated UUID entry is a safe interim state; only build the EntityPicker search endpoints if data-entry errors become a real support burden. |
| `municipal` (orig. #1897) | No workflow-task API for approve/reject/inspect/issue on citizen service applications. | **Real product gap, not just UI polish** — citizens' municipal applications currently can't be progressed through the new UI. Recommend prioritizing a minimal workflow-task API for municipal services. |
| `journeys` (orig. #1900) | No pause/stop/activate UI — deliberately deferred because activating a citizen journey has real communication side effects. | Correct to defer. Build only with a proper ConfirmDialog + maker-checker UX, not as a quick patch. |
| `domains` (orig. #1911) | No domain-service/gateway route exists at all — this entire module is UI-only today, with no server-side enforcement possible. | **Decide if `domains` is a planned feature or dead UI.** If planned, scope the backend service. If not, consider removing the route rather than carrying a half-built form indefinitely. |
| `setup` (orig. #1908) | No settings/preference endpoint to persist a "skip this step" choice in the onboarding wizard. | Low priority UX nicety for returning users. |

## 6. Honest-copy / scope-narrowing decisions (lowest risk — mostly "confirm the call was right")

Cases where the fixer removed a false claim, hid a broken feature, or labeled something read-only rather than inventing data or a fake action:

- `plugins` (orig. #1922): hooks list made read-only — plugin-service has no enable/disable verb server-side. **Agree, correct call, no action.**
- `knowledge` (orig. #1879): record disposal left read-only — GFR-governed, irreversible, no backend dispose command exists. **Agree, correct call.** Only revisit if there's a genuine business need; disposal deserves its own design (approval + certificate + audit), not a quick add-on.
- `docs`, `dashboard` (orig. #1901, #1902): dead PDF download links removed; unsourced marketing stats/competitor claims removed. **Agree, correct call.** Action item: get a content/marketing owner to review the new authored copy once before publish.
- `recommendations` (orig. #1898): NBA accept/dismiss not built — would be a different resource than the read-only predictive feed. **Agree, correct call.**

## 7. Pre-existing issues surfaced (not introduced by Wave 4, now resolved)

| Issue | Where | Status |
|---|---|---|
| Duplicate migration numbers | `tenant-service` 0015 | ✅ **Fixed (2026-10-07).** `0015_placement_policy.sql` renamed to `0027_placement_policy.sql` (next free slot). The service's `migrate-all.mjs` has no filename-keyed journal — it just `readdirSync().sort()`s and runs idempotent SQL — so renaming is safe; verified by re-running the renamed file against the test DB (clean no-op). |
| Duplicate migration numbers | `report-service` 0016 | ✅ **Fixed (2026-10-07).** `0016_template_watermark_pii.sql` renamed to `0019_template_watermark_pii.sql` (next free slot), same reasoning and verification as above. |
| Duplicate migration numbers | `workflow-service` 0004/0012 | ✅ **No action needed.** Confirmed a false positive — `0012_call_depth_guard.sql` and `0012b_seed_definition_edges.sql` are distinct filenames (the `b` suffix was already the intended disambiguation), not a real collision. |
| Failing `org-hierarchy` reparent test | `tenant-service` | ✅ **Fixed (2026-10-07).** Root cause: the test's `wipe(tenantId)` helper only ever deleted from `orgUnits`, never from `_outbox.messages`. Since this runs against the shared, persistent test Postgres (never reset between agent sessions), every historical run of the file left its audit-event outbox rows behind under the same deterministic UUIDs — confirmed with a direct query: 217 accumulated rows for one tenant spanning 24+ hours of repeated runs. Fixed by having `wipe()` also delete from `outboxMessages`. Verified by running the test file twice in a row (13/13 pass both times) and the full tenant-service suite (30 files / 398 tests, 0 regressions). |
| Contract mismatch: `operator` vs `op` | `RunQueryForm` (web) vs analytics-service querySpec filter schema | ✅ **Fixed (2026-10-07).** The web form now posts `{ field, op, value }` instead of `{ field, operator, value }`, matching the server's `filterSchema` in `registry/spec.ts` (`analytics-query/validators.ts` uses the same `op` key). Added `RunQueryForm.contract.test.tsx`, which pins the real wire contract — verified it fails against the old `operator` key and passes against the fix. |
| 13 failing bulk-scan test files | `document-service`, test DB missing the `bulk_scan` schema migration | ✅ **Fixed (2026-10-07).** Applied the pending migrations (`0005`–`0009`) to the shared test DB — a DB-state fix only, no code/migration files changed (the migrations already existed in the repo; they just hadn't been run against this particular persistent test DB instance). Full suite now: 390 passed, 14 skipped (intentional), 0 failed. Re-ran twice to confirm stability. |

---

## Prioritized action plan (updated 2026-10-07)

Items 1, 2 (half), and 7 (all) from the original plan are done — see the resolution summary at the top. What's left:

1. **This week** — confirm the `plugins` marketplace-install role mismatch fix (flagged on PR #1922) gets applied before that PR merges.
2. **This week** — confirm the demo-tenant data/side-effect posture for `sandbox` with product/ops (code-level fail-closed behavior is already verified).
3. **Next sprint** — build the single "resolve user id → display name" endpoint; unblocks audit-readability items in `workflow` and `change`, and likely future modules too.
4. **Next sprint** — do the one consolidated `ModuleListTable` → `DataTable` migration PR; retires ~15 deferred LOW items across 4 modules at once.
5. **Backlog, prioritize by business value** — real backend work for analytics KPIs (closes a false-positive executive-dashboard bug), municipal workflow actions (citizens currently can't be served end-to-end), and a build-or-kill decision on `domains`.
6. **Backlog, low urgency** — everything else in sections 3 and 5 above: one-time content/finance/legal sign-offs. Section 6 (scope-narrowing decisions) needs no action — reviewed and agreed correct.

---

*This document was generated from the per-PR "Needs human review" and "Left open" sections of PRs #1874–#1922. Per-item file:line evidence and the full decision rationale for every gap item lives in the individual PR descriptions and the `~/overnight/<module>/batch*.md` working files from the remediation run.*
