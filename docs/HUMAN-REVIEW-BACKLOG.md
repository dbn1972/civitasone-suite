# Human Review Backlog — Gap-Ledger Remediation (Wave 4)

**Generated:** 2026-10-07
**Scope:** All 55 gap-ledger modules closed across PRs #1874–#1922 (Wave 4), covering 4,644 tracked gap items (1,204 HIGH, 2,196 MEDIUM, 1,244 LOW).
**Status as of writing:** 4,509 items fixed/verified; 55 items left `[~]` partial pending one of the decisions below; 0 modules untouched.

This document consolidates every "Needs human review" and "Left open" note surfaced across the Wave 4 PRs into one place, grouped by risk/urgency, each with a concrete recommendation. It is meant to be triaged once and either closed out (decision made → file a follow-up PR) or converted into tracked issues.

> **PR bundling note:** the repository owner is squashing groups of these PRs into combined PRs (`chore: combined gap PR N/4`). As of writing: #1923 (covers former #1885–1894) and #1924 (covers former #1895–1904) are merged; #1916 (1874–1884) and #1925 (1905–1915) are open; #1917–#1922 (change/contracts/documents/inspection/metadata/plugins) are standalone. The PR numbers below refer to the **original per-module PRs** where the decision was recorded — use `git log --grep=GAP-<ID>` or the module's gap-ledger file to find the current location of the change if a PR number below has since been superseded.

---

## 1. Security / production-safety — verify before next prod deploy

| Source | Decision needed | Recommendation |
|---|---|---|
| `auth` (orig. #1899) | Confirm `ENABLE_DEV_LOGIN` is unset in every staging/prod config; the shared dev-login password must live only in an untracked `.env`, never in docs/CI configs in cleartext. | **Verify immediately.** Grep all env files and CI/CD pipeline configs for `ENABLE_DEV_LOGIN=true`. This is a full authentication bypass if misconfigured — highest consequence, lowest effort to check. |
| `sandbox` (orig. #1912) | Confirm the demo tenant contains no real data and no live side effects (email/payment); confirm `ENABLE_SANDBOX` is never `true` in production. | **Verify immediately**, same risk class as above. Recommend adding a CI assertion that fails the build if `ENABLE_SANDBOX=true` appears in any prod-tagged environment config. |
| `court` (orig. #1893) | Judicial order DSC signing is still a pasted blob with structural (not cryptographic) validation. Real signer-token/eSign integration and server-side certificate verification are outstanding. | **Not a merge blocker** — track as a dedicated PKI integration project. Judicial order issuance is legally sensitive; don't rush this into the current fix cycle. |
| `estab` (orig. #1874) | Quarter vacate/cancel actions affect licence-fee payroll deductions; DSC signature copy needs legal wording sign-off. | Confirm with payroll/legal before the next payroll cycle runs. Low risk to merge the code now. |

## 2. Authorization gaps — UI/server role-list mismatches

None of these are exploitable (the server is always the authoritative gate), but they cause confusing 403s or let the UI loosen/tighten the wrong direction.

| Source | Mismatch | Recommendation |
|---|---|---|
| `settings` (orig. #1906) | UI role gate admits `tenant_admin` for branding; theme-service's server-side `ADMIN_ROLES` does not — a tenant_admin sees Save enabled, then gets a 403. | **Add `tenant_admin` to the server's `ADMIN_ROLES`.** Tenant admins managing their own tenant's branding is the natural product fit — loosen the server to match the UI, not the other way round. |
| `plugins` (orig. #1922) | `plugin_admin` sees the Marketplace Install button, but server install is restricted to `super_admin`/`platform_admin` only. | **Narrow the UI, not the server.** Installing from a public marketplace into a live tenant is the more dangerous direction to loosen — keep the server restrictive and hide the button for `plugin_admin`. |
| `recommendations`, `developer-portal`, `library` (orig. #1898, #1910, #1914) | New web role gates were added, mirrored or inferred from server roles without a direct cross-check in every case. | Confirm each gate against actual production role assignments. Worst case if wrong is over-restrictive (fail-closed), not a security hole — low priority but should be checked once. |

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

## 7. Pre-existing issues surfaced (not introduced by Wave 4, now documented)

| Issue | Where | Action |
|---|---|---|
| Duplicate migration numbers | `tenant-service` 0015, `report-service` 0016, `workflow-service` 0004/0012 | File a tech-debt ticket to renumber. Not urgent, but a landmine for the next migration author who collides with these numbers. |
| Failing `org-hierarchy` reparent test | `tenant-service` | File a ticket; confirmed failing on untouched `main`, unrelated to Wave 4 changes. |
| Contract mismatch: `operator` vs `op` | `RunQueryForm` (web) vs analytics-service querySpec filter schema | File a ticket; one side needs to change the field name. |
| 13 failing bulk-scan test files | `document-service`, test DB missing the `bulk_scan` schema migration | Apply the pending migration to the shared test DB — an environment fix, not a code fix. |

---

## Prioritized action plan

1. **This week** — verify `ENABLE_DEV_LOGIN` and `ENABLE_SANDBOX` are correctly unset in every staging/prod config. 10 minutes, highest consequence if wrong.
2. **This week** — fix the two authz mismatches with a one-line server-side change each: add `tenant_admin` to theme-service `ADMIN_ROLES`; narrow the plugins marketplace-install UI to match the server's restrictive role set.
3. **Next sprint** — build the single "resolve user id → display name" endpoint; unblocks audit-readability items in `workflow` and `change`, and likely future modules too.
4. **Next sprint** — do the one consolidated `ModuleListTable` → `DataTable` migration PR; retires ~15 deferred LOW items across 4 modules at once.
5. **Backlog, prioritize by business value** — real backend work for analytics KPIs (closes a false-positive executive-dashboard bug), municipal workflow actions (citizens currently can't be served end-to-end), and a build-or-kill decision on `domains`.
6. **Backlog, low urgency** — everything else in sections 3, 5, and 6 above: one-time content/finance/legal sign-offs and the pre-existing tech-debt tickets in section 7.

---

*This document was generated from the per-PR "Needs human review" and "Left open" sections of PRs #1874–#1922. Per-item file:line evidence and the full decision rationale for every gap item lives in the individual PR descriptions and the `~/overnight/<module>/batch*.md` working files from the remediation run.*
