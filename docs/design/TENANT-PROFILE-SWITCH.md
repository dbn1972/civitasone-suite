# Tenant-type profile switch and the small government office profile

Status: DESIGN for review. No code. Branch `design/tenant-profile-switch`, base `origin/main` 463061cae (2026-11-06).
Constraint: parallel work, OFF the UAT server until the 18-20 Nov screen sign-off. Everything below ships behind `TENANT_PROFILES_ENABLED` (default false), so a merge after sign-off still changes nothing until the flag is turned on.
Paths are under `services/` unless they start with `apps/` or `packages/`. "Wired" means a live caller was found in source; "unwired" means none was.

## 0. Findings that change the brief

1. **`small_office` is the MSME edition, not a government one.** `POST /v1/tenant/msme-onboard` hard-codes `edition: "small_office"` (tenant-service/src/modules/tenant/routes.ts:224-299). The live tenant DB has 12 `govt` and 12 `small_office` tenants. A government small office therefore cannot be a new edition value. It is a profile inside edition `govt`. The CHECK in migration 0034 stays untouched.
2. **There are three overlapping taxonomies.** (a) `edition`, 7 values (tenant/validators.ts:7). (b) the composition profile code (`govt_dept`, `psu`, `small_office`, `smarttransfer_standalone`), with an ad-hoc `govt` to `govt_dept` translation (admin-service/src/modules/tenants/tenant-created.ts:41). (c) `settings.orgType`, 8 UI values (apps/web/src/lib/orgConfig.ts:12), validated server-side (tenant/validators.ts:27) but read by no service except meeting-service. (c) is cosmetic and stays that way.
3. **The module registry now has 42 modules and 9 bundles, not 34/8.** Live `composition.module_registry` adds `workforce_core`, `smarttransfer`, `telephony`, `meeting`, `court`, `visitor`, `billing`, `field` on top of the 34 seeded in admin 0026.
4. **`composition.tenant_profile` is populated for only 8 of 24 tenants** (6 govt_dept, 1 psu, 1 small_office). It is written only by `POST /v1/admin/composition/onboard` and apply-plan (composition/routes.ts:226, repo.ts:167,200). It is not reliable as a source of truth.
5. **Module gating is off unless the tenant's enforcement mode is `shadow` or `enforce`** (gateway-service/src/module-guard.ts header). A bundle by itself hides nothing.
6. **The AP bill path is govt-only today.** payments/consumer.ts:176 runs `assertValidHoAWithMaster(head.hoaCode)` and :178 requires the DDO in the master, for every bill. A commercial tenant cannot pass a bill. This is a prerequisite for commercial COA, not for the small government office.
7. The major-head seed in tenant-onboard/consumer.ts (CGA heads, around 75 rows) goes into a **global** table (`financeMajorHeads`, PK `code`, no tenant). After the first tenant it is a no-op. Only `seedStandardGlHeadsTx` is per-tenant.

## 1. Profile model

**Decision.** Profile definitions live in code, in a new pure package `packages/tenant-profile`. The profile assignment lives on the tenant, in tenant-service. Each service materialises the settings it owns into its own tables.

- **Catalogue (code, versioned).** Each profile entry: `{ code, family, editions[], accountingBasis, budgetControl, coaTemplate, statutoryPack, bundleCode, active }`. It is pure, so it is unit-testable and has no cross-service DB read. `org_profile.statutory`, `rule_packs` and `default_modules` become display projections generated from this package. A CI test asserts they match, which ends the dual-source problem (rule_packs have no consumers today).
- **Assignment.** Add `tenant.tenants.profile_code varchar(32) NOT NULL` (tenant-service migration 0035). It sits next to `edition` (schema.ts:15), is set atomically at onboard, and is returned by the existing `GET /v1/tenants/:id`. Rejected: extending `composition.tenant_profile` (admin RLS and breaker, 1/3 populated). It becomes a projection, upserted by an admin consumer via the existing `applyProfile`.
- **Edition to profile.** Default map: `govt` to `govt_dept`; `psu` to `psu`; `small_office` to `small_office`; `section8` to `section8`; `private`, `ngo`, `cooperative` to the same-named placeholder. `OnboardTenantBody` (onboard.ts:25) gains optional `profile`, validated against `profile.editions`. Example: `govt` accepts `govt_dept` and `govt_small_office`.
- **How services learn it.** (1) `profileCode` and `profileVersion` are added to `tenant.tenant.created` and `tenant.tenant.onboarded` (onboard.ts:112-117, tenant/consumer.ts:132-137). Consumers treat an absent value as the edition default. (2) A new `tenant.tenant.profile_changed` event. (3) Read API: `GET /v1/tenants/:id` returns `profileCode` plus the resolved block. Payroll and procurement read it with a shared copy of the payroll cache (payroll-service/src/modules/deductor-config/tenant-identity.ts:70-95: 60 s TTL, 3 s timeout, fail-closed). **finance-service never calls out in the posting path.** It reads its own `gl.finance_settings` via `loadSettingsTx`. No `x-tenant-edition` header. The unused header in finance `simplified/routes.ts:34` is not extended.
- **Profiles.**

| Profile | Basis | Budget | COA | Active in this work |
|---|---|---|---|---|
| `govt_dept` | cash | mandatory | govt | yes (today's behaviour) |
| `govt_small_office` | cash | mandatory | govt + office pack | yes |
| `psu`, `private`, `ngo`, `cooperative` | as today (cash/mandatory/govt) | | | legacy-equivalent, `active:false` |
| `small_office` (MSME, relabelled "Small business / MSME") | placeholder: accrual/advisory/commercial | | | `active:false` |
| `section8` (new placeholder) | placeholder: accrual/advisory/nonprofit | | | `active:false` |

Inactive profiles carry intended values but are not offered in the wizard, and the consumer treats them as legacy. This keeps the 12 existing MSME tenants and the live signup route unchanged.

## 2. The four settings

### 2.1 Accounting basis
Wired (gl.finance_settings.accounting_basis, migration 0160; read in gl/consumer.ts:444,520,618,668,958; changes need approval via approvals/domain.ts:49). No change except the **initial value**: the onboarded consumer inserts the profile's basis. The 0026 `rule_packs.accounting_basis` strings stay labels.

### 2.2 Budget control: mandatory | advisory | off
**Migration (finance 0162).** `ALTER TABLE gl.finance_settings ADD COLUMN IF NOT EXISTS budget_control varchar(10) NOT NULL DEFAULT 'mandatory'` plus `CHECK (budget_control IN ('mandatory','advisory','off'))`. Same migration adds `coa_template varchar(12) NOT NULL DEFAULT 'govt'` (CHECK govt|commercial|nonprofit) and `profile_code varchar(32) NOT NULL DEFAULT 'govt_dept'`. Postgres adds a defaulted NOT NULL column as metadata only. Rollback is `DROP COLUMN`. `schema.ts:6-20` and `FinanceSettings`/`SETTINGS_DEFAULTS` (approvals/domain.ts:10,32) gain `budgetControl: "mandatory"` and `coaTemplate: "govt"`. An absent settings row therefore still means today's behaviour (only 1 row exists in the live DB).

**Code changes (enforcement points, all found by grep).**
- `budget/provision.ts:33` `needsBudgetProvision(head, journal)` stays pure and unchanged (it answers "does this debit draw on a provision"). A new pure `provisionAction(mode, needs, hasRow)` returns `refuse | warn | allow`. It is `refuse` only when the mode is mandatory, the head needs provision and there is no row.
- `assertProvisionTx` (:54) loads the mode via `loadSettingsTx`. mandatory: throws as today. advisory: returns `ProvisionWarning[]` instead of throwing. off: returns `[]` without querying budgets. The return type changes from `void`.
- `gl/consumer.ts:311-313`: `if (head && needsBudgetProvision(...)) throw` becomes mode-aware. Advisory enqueues an audit row `post_journal_budget_advisory` (same `enqueue(tx, {topic: AUDIT_TOPIC...})` shape as the override audit at :320-331, with headId, fy, requestedMinor, reason `NO_PROVISION`) and posts. When a row exists but the debit exceeds `available` (`assertBudgetNotExceeded` at :~335), advisory logs the same audit row with reason `OVERDRAW` and takes the existing `incrementBudgetUtilisedForced` path (:~323). `budget_override` stays false because advisory is not an override. In off mode the whole block (:~285-345) is skipped, including utilisation tracking.
- `payments/consumer.ts:387` (bill approval) and the sync pre-checks `assertProvisionHttp` callers: gl/routes.ts:91,138; payments/routes.ts:244,263; budget/routes.ts:171,197. In advisory they return 2xx with `meta.warnings[{code:"NO_BUDGET_PROVISION", headCode, fy}]` and the web shows a toast. mandatory keeps the 422.
- Exempt journal types (provision.ts:26) are untouched. A grep test over `needsBudgetProvision|assertProvision` call sites fails CI on a new unguarded site.

### 2.3 Chart-of-accounts template
`standardGlHeads()` (gl/standard-heads.ts:42-98) splits into **core** and **template heads**. Core is every code a posting path resolves by code (cash 1100, 1101, 1200/1250, 1300, 2050, 2060, 2101-2108, 2200, 3100, 4001, 4010, 4090, 4100, 4200, 4300, 4310, 5001, 5002, 5100, 5101, 5200, 6100; accrual-only stores heads stay in `accrualStoresHeads`). Core keeps GPF/NPS (2104/2105) and 4100 for every template: `payrollDeductionHeads()` and the revenue path resolve by code, and a tenant with the wrong template should never see UNKNOWN_ACCOUNT_CODE. `tests/b10-standard-gl-heads.test.ts` already scans posting modules and fails if a default code is missing; it is extended to assert `core ⊇ scanned codes`.

Template-specific heads are only the **default bill head** (lines 82-83: `2202 General Education` with HoA `220201101010101000`) plus additions:

| Template | Heads (code name, classification) |
|---|---|
| `govt` | 2202 General Education (expense, HoA). **Byte-identical to today's seed, asserted by a snapshot test.** |
| `govt` + `office-pack` (govt_small_office only) | 5410 Office Expenses, 5420 Travel Expenses (TA/DA), 5430 Contingent Expenditure, 5440 Repairs and Maintenance, 5450 Vehicle Hire and POL, 5460 Electricity, Water and Telephone (all expense) |
| `commercial` | 5400 Purchases and Direct Expenses (default bill head); 1500 Advances and Deposits Paid; 1600 Prepaid Expenses; 1700 GST Input Credit; 1800 TDS Receivable (assets); 2300 GST Payable; 2310 Income Tax Payable; 2400 Short-term Borrowings; 2500 Accrued Expenses (liabilities); 3000 Share Capital / Proprietor's Capital; 3200 Reserves and Surplus (equity); 4400 Interest Income (income); 5410 Rent and Utilities; 5420 Professional Fees; 5430 Travel and Conveyance; 5440 Repairs and Maintenance; 5450 Office Administration; 6200 Bank Charges and Interest (expense) |
| `nonprofit` | 5400 Programme Expenses (default bill head); 1500 Advances and Deposits Paid; 1550 Grants Receivable (assets); 2300 Unutilised Grants (liability); 2310 FCRA Foreign Contribution Unutilised (liability); 3000 Corpus Fund; 3200 Restricted and Designated Funds (equity); 4400 Grants and Donations Received; 4410 Membership Fees; 4420 Interest on Investments (income); 5410 Staff Costs; 5420 Administrative Expenses; 5430 Fundraising Expenses; 5440 Grants Disbursed to Partners; 6200 Bank Charges (expense) |

Codes obey the existing nature rules (head-nature.ts: 1 asset, 2/3 liability or equity, 4 income, 5/6 expense) and avoid every core code. The same code can mean different things across templates, so cross-tenant analytics must use classification, not code. `FINANCE_GRN_BILL_HEAD_CODE` and `WORKS_FINANCE_BILL_HEAD_CODE` still win when set (gl/system-heads.ts:62; works-service/src/modules/billing/consumer.ts:33). Their `"2202"` fallbacks become `templateDefaultBillHead(template)`. The works-service side needs a finance lookup (`GET /v1/finance/accounts/default-bill-head`), needed only for non-govt templates. `seedStandardGlHeadsTx` (:136) becomes `seedGlHeadsTx(tx, tenantId, template, packs, actor)`, which is still `ON CONFLICT DO NOTHING`, add-only, and idempotent. `scripts/backfill-standard-gl-heads.ts` calls it with the tenant's stored template.

### 2.4 Statutory pack and module bundle
- **Statutory pack** is a key in the catalogue: `govt_in` (GPF, NPS, UPS, TDS, PT; EPF/ESI off; deductorCategory `government`), `commercial_in`, `nonprofit_in`. Unwired today: nothing reads `org_profile.statutory`. The single reader is payroll, via the cached tenant read API. It supplies (a) the default `pensionScheme` for new employees (today hard-coded `"NPS"` in pay-profiles/plan.ts:82,129) and (b) a **prefill suggestion** for `documentIdentity.deductorCategory`. That is the PANNOTREQD case (deductor-config/domain.ts:29,86), and the tenant admin still confirms it; the profile never overwrites it.
- **Module bundle** goes through the existing composition guard. A new `module_bundle` row `govt_small_office` (admin migration, upsert) plus an `org_profile` row of the same code. The admin consumer applies it on `onboarded` through `applyProfile` (repo.ts:167). New small-office tenants start in enforcement mode `shadow` (would-deny logged) and are flipped to `enforce` after the soak. Gateway route keys differ from registry ids (`projects`, `assets`, `stock`, `grants` in module-guard.ts vs `project`, `asset`, `inventory`, `grant`); the existing composition/gateway-map.ts is covered by a test for every bundle module.

## 3. Backward compatibility

- **Backfill rule.** Every existing tenant, whatever its edition: `budget_control = 'mandatory'`, `coa_template = 'govt'`, `profile_code = 'govt_dept'` in finance (column defaults; no data rewrite). In tenant-service, `profile_code = CASE edition WHEN 'govt' THEN 'govt_dept' ELSE edition END` (migration 0035). The 12 MSME tenants keep legacy behaviour.
- **Flag.** With `TENANT_PROFILES_ENABLED=false` the finance consumer ignores `profileCode` and seeds exactly as today. With it true, `govt_dept` resolves to the same values.
- **Tests that prove no change for govt tenants.**
  1. Snapshot: `seedGlHeadsTx(govt)` rows equal today's `standardGlHeads()` (code, name, classification, hoaCode, isControl).
  2. gl-budget-check matrix, run on absent-row, `mandatory` row, and no-flag: NO_BUDGET_PROVISION, BUDGET_EXCEEDED and the override audit are unchanged (extend tests/gl-budget-check.test.ts and tests/journal-budget-override-routes.test.ts).
  3. Migration test: apply 0162 to a DB with the pre-existing row, then assert the defaults.
  4. Onboard a `govt` tenant with the flag on and off and diff the resulting heads, settings row and events.
  5. A parity run of `backfill-standard-gl-heads.ts --dry-run` over a copy of the UAT DB: zero missing heads.
  6. Contract test: a consumer fed the old payload (no `profileCode`) behaves as before.

## 4. Changing a profile after go-live
"Go-live" = any posted journal (`gl.finance_journals`) or any payroll run. Reuses `gl.finance_change_requests` (`settings_relax` and `period_reopen` always need a distinct approver, approvals/domain.ts:54).

| Change | Rule |
|---|---|
| Budget control: tighten (off to advisory to mandatory) | Direct, audited |
| Budget control: relax (mandatory to advisory/off, advisory to off) | Maker-checker. Add `budgetControl` to `isRelaxingControl` (domain.ts:47) as a `settings_relax` |
| Accounting basis | Unchanged: maker-checker (domain.ts:49). Proposed addition: effective only from the start of a financial year |
| COA template, before any posting | Direct, admin-only; add-only re-seed |
| COA template, after first posting | **Refused** (`COA_TEMPLATE_LOCKED`). Heads never move or rename; extra heads are added through the normal head-creation screen |
| Profile within the same family (`govt_dept` and `govt_small_office`) | Maker-checker, new kind `profile_change` (needs the `finance_change_requests_kind_check` update, as migration 0161 did). Bundle changes are additive; removal is the existing 409-if-depended-on rule |
| Profile across families (govt to commercial) after go-live | **Refused.** Needs a new tenant and data migration |
| `edition` | Immutable after onboarding (drives placement tier and billing) |

## 5. Small government office profile (`govt_small_office`)
Target: a block or tehsil office, sub-registrar or district-level section; 15-60 staff; one DDO; draws from a treasury or PAO; no citizen counter.

**Section 8 fix.** Relabel the `small_office` org_profile row (label only; code stays so 12 tenants and 1 tenant_profile row are untouched) to "Small business / MSME". Add a `section8` placeholder (nonprofit, inactive).

**Bundle** (registry ids; core 5 are implicit; 17 chosen; 22 of 42 effective). Hard-deps all resolve inside the set.

| Cluster | Included | Why |
|---|---|---|
| hr | employee, attendance, leave, appraisal, ess | Service book, leave rules, APAR, self-service. |
| payroll | payroll, loans, benefits, separation | DDO bills, advances, TA/DA/LTC/medical, pension papers. |
| finance | finance, budget, treasury | GFR needs allotment-bound expenditure, bank/treasury. |
| p2p | procurement, inventory, asset | GFR purchase, stock register, asset register. |
| governance | legal | RTI is mandatory for every public authority. |
| insight | analytics | MIS. |

Excluded: recruitment, career (done by the parent department), workforce_core, smarttransfer, revenue, contract, works, project, grant, citizen, crm, helpdesk, knowledge, inspection, telephony, meeting, court, visitor, billing, field. Optional add-ons via one-click bundles: `revenue` (fee-collecting offices), `citizen`+`helpdesk`, `works`.

**Setup defaults.** Financial year 1 April (org-structure/schema.ts:36). INR. Cash basis. Budget mandatory. Maker-checker on (SETTINGS_DEFAULTS). Two pay groups: gazetted and non-gazetted (pay-group-domain.ts:15). Default pension scheme NPS; GPF for employees recruited before 2004. COA `govt` plus `office-pack`. A "quick allotment" form creates `finance_budgets` rows per head. Worked example: Office of the Block Development and Panchayat Officer, Sohna (Gurugram, Haryana); DDO `HRGGN04217` (matches PFMS_DDO_REGEX, shared/pfms.ts:14); PAO Gurugram; treasury Gurugram. FY 2026-27 allotment (rupees): 5001 Salary Expense 1,84,00,000; 5002 Employer Contributions 18,40,000; 5410 Office Expenses 6,50,000; 5420 Travel Expenses 2,40,000; 5430 Contingent Expenditure 3,00,000; 5440 Repairs and Maintenance 4,20,000; 5460 Electricity, Water and Telephone 5,10,000; 2202 default bill head 1,00,000 (rename to a department head is a follow-up).

**DDO and IFMS: what really exists.**
- Wired: DDO master and sync (finance `/v1/finance/ddo`, masters/routes.ts:176; masters/consumer.ts ddo_sync); `ddoCode` on org-structure (schema.ts:33); a required, regex-checked `ddoCode` on payment commands (payments/validators.ts:5,31,61); payroll `payroll_ddos` (migration 0014) with the pay-group DDO active check (pay-group-commands.ts:109-111); bill approval requires the DDO in the master (payments/consumer.ts:178).
- Sandbox/stub: PFMS treasury calls return simulated results unless credentials are set (pfms/pfms-client.ts:324,403,455,535). **IFMS: no integration exists.** The only trace is the `bills.ifms_ref` varchar in works-service (billing/schema.ts:55). I did not find GPF annual-statement or AG/PAO remittance generation, so it is not claimed.
- GPF/NPS/UPS: wired (PensionScheme `GPF|NPS|EPF|UPS|NONE`, payroll/domain.ts:50; GL heads 2104/2105, gl/system-heads.ts:33-34).
- **GeM/GFR.** GFR mode bands are wired into tender creation (procurement tender/commands.ts:9, gfr/mode-bands.ts; bands in gap/gfr-bands.ts, e.g. local purchase up to Rs 5,000, direct purchase up to Rs 25,000, limited tender up to Rs 10 lakh). The GeM adapter and reconcile routes are registered (app.ts:90-103) but **fail closed unless `GEM_ENABLED=true` with credentials** (gem/integration-adapter.ts:43). I found no rule forcing "GeM first". The profile adds an advisory banner only.

## 6. Onboarding and setup wizard
**What exists.**
- `apps/web/src/app/(app)/setup/SetupWizard.tsx` renders 8 steps from `lib/setupSteps.ts` (org-profile, branches, departments, people, modules, finance-year-coa, leave-policies, pay-structure). Statuses come from data via `setup/progress.ts:129`.
- Its "org-profile" step links to `tenant-admin/org-type/OrgTypeSelector.tsx`, which PATCHes the cosmetic `settings.orgType` only. It touches neither edition, profile nor composition.
- `install-service` onboarding (orchestrator/onboarding.ts) has 3 steps: deployment-mode, org-profile (manual), then `activate_domain_pack` for `municipal-in-v1` (trade licence, PGR, water; domain-pack-constants.ts:2-6), which is wrong for a small office.
- I did not inspect the platform-admin create-tenant form that sets edition; slice 7 confirms it.

**Minimal changes.** (1) `defaultOnboardingSteps(domainPackKey)` omits step 3 when the profile is not municipal. (2) The org-profile step shows the resolved profile (read-only after go-live; before go-live, picking `govt_dept` vs `govt_small_office` raises the section 4 change). (3) For `govt_small_office`, add a required setup step "DDO and allotment" (DDO code, PAO, quick allotment), visible only for that profile, using the existing module-scoped visibility in setupSteps.ts. (4) en/hi strings. No change to `settings.orgType`.

## 7. Implementation plan (PR-sized, in order)

| # | Slice | Files | Tests | Effort |
|---|---|---|---|---|
| S0 | `packages/tenant-profile` + flag | new package; catalogue, resolver, tenant read client (copy of tenant-identity.ts) | catalogue invariants (valid settings; every edition has a default); org_profile projection equality | 1 d |
| S1 | tenant-service profile | migration 0035; tenant/validators.ts, onboard.ts, events.ts, consumer.ts:132, repo/schema, GET | backfill CASE; old payload; edition vs profile validation | 1.5 d |
| S2 | finance settings columns | migration 0162; approvals/schema.ts, domain.ts, repo.ts, routes.ts:42 | defaults; absent-row; relax rule | 1.5 d |
| S3 | budget control modes | budget/provision.ts, gl/consumer.ts:311, payments/consumer.ts:387, 4 route files, web toast | mode x head x row matrix; audit row; govt snapshot (section 3 #2) | 3 d |
| S4 | COA split + templates | gl/standard-heads.ts, system-heads.ts:62, tenant-onboard/consumer.ts, scripts/backfill-standard-gl-heads.ts, HoA/DDO skip for non-govt bills | snapshot parity; b10 scan; seed idempotency; commercial bill passes | 3 d |
| S5 | admin composition | admin migration (org_profile rows, bundle, relabel), composition consumer on onboarded/profile_changed | bundle deps; gateway-map coverage; relabel | 1.5 d |
| S6 | payroll/procurement readers | payroll plan.ts default scheme, deductor prefill; procurement banner | scheme default; fail-closed on 503 | 1.5 d |
| S7 | web + install-service | setupSteps.ts, progress.ts, OrgTypeSelector, onboarding.ts, i18n | wizard visibility; e2e | 2 d |
| S8 | post-go-live guards | finance_change_requests kind migration 0163; `COA_TEMPLATE_LOCKED`; profile_change request | refusal cases; distinct approver | 1.5 d |

About 17 dev-days. S0 to S3 are the critical path. Migration numbers are the next free ones at implementation time.

**Re-test before UAT (after sign-off).** Full finance UAT T-PERIOD regression for a govt tenant (bill pass, payments, payroll accrual, year end, period reopen) with the flag off, then on; the backfill dry-run parity on a UAT DB copy; a 48 h module-guard `shadow` soak for a small office tenant; the setup wizard e2e and axe checks for the new step; a gitleaks run per commit.

**Risks.** (1) A missed enforcement point leaves a hard refusal in advisory mode; mitigated by the central mode helper and the call-site grep test. (2) A cash-to-accrual switch mid-year distorts statements. (3) Commercial bills fail on HoA/DDO until S4's skip. (4) Bundles do nothing in enforcement `off`. (5) The `2202 General Education` default is wrong for non-education offices; touching it for govt would break "unchanged", so it is deferred. (6) Event ordering: `onboarded` can arrive before settings exist; inserts are idempotent and tested. (7) Off mode stops utilisation tracking; the UI must say so.

## 8. Out of scope: follow-on designs this switch enables
- **Section 8**: FCRA and fund accounting, 12A/80G, nonprofit statements, grant utilisation.
- **MSME**: GST-first books, Udyam sector module sets, retiring finance `simplified/` (no live caller).
- **PSU**: accrual books with the commercial template, IDA pay, EPF/gratuity, DPE/CAG audit profile.
