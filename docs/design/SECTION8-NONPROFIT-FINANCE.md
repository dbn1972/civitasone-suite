# Section 8 (non-profit) segment — nonprofit finance layer: paper design

**Status:** DESIGN for review. No code. Companion to `~/orch-logs/segments/section8-design.md` (HR/payroll/leave/costing), which explicitly defers this layer ("FCRA and fund accounting, 12A/80G, nonprofit statements, grant utilisation … This document does not cover those"). This document is that deferred separate design.

**Source:** repo `~/CivitasOne/civitasone-suite` at `origin/main` after #2468 (`b0dce081b`), read-only; the tenant-profile design `docs/design/TENANT-PROFILE-SWITCH.md` (branch `origin/design/tenant-profile-switch`, PR #2467) and its merged S0–S3 code (#2468); and an as-is capability map run 15 Nov 2026. Line numbers are from `origin/main` and will drift — re-grep before coding.

**Constraint:** parallel work, OFF the UAT server until the 18–20 Nov screen sign-off. Everything ships behind flags defaulting **false**, so a merge after sign-off changes nothing until a flag is turned on per tenant.

**VERIFY** marks a statutory or legal figure/rule not confirmed from an authoritative source. Figures quoted from the repo are what the code is configured with, not a statement that they are correct today. No sentence here is a statement of current law; every threshold is configuration with a named reviewer.

---

## Cross-cutting contract (read first): configurable rules & tenant isolation

This is the non-negotiable frame for everything below. Owner instruction, 15 Nov: *reviewers always; no violation of other tenant types; establish configurable rules.*

1. **Data-keyed, never edition-forked.** No business-logic branch reads the `edition` or tenant-type string to decide behaviour. Behaviour is decided by **stored configuration**: the profile catalogue (`packages/tenant-profile`), a fund master, `gl.finance_settings.coa_template` / `accounting_basis` / `budget_control`, the statutory pack, and per-tenant feature flags. A govt/PSU/MSME tenant executes the identical path it does today.
2. **Flags default OFF.** Two flags gate this layer: the existing `TENANT_PROFILES_ENABLED` (must be on to activate any non-legacy profile) and a new `NONPROFIT_FINANCE_ENABLED` (per-tenant; gates funds, FCRA, donations, nonprofit statements). With both off, `effectiveSettings()` returns `LEGACY_SETTINGS` (cash/mandatory/govt) for every tenant (`packages/tenant-profile/src/index.ts:118-121`) and no new code path runs.
3. **Additive-only.** New tables, new nullable/defaulted columns, new GL heads seeded `ON CONFLICT DO NOTHING`. No existing row is rewritten, no existing head moves or is renamed (the tenant-profile doc already locks COA templates after first posting: `COA_TEMPLATE_LOCKED`).
4. **Proven isolation, not asserted.** Every slice ships with golden/snapshot regression tests asserting that govt, PSU and MSME tenants produce **byte-identical** postings, payroll, and statement outputs with the flags off AND on (a `govt_dept` tenant resolves nonprofit code to the same values it has today). A CI grep test fails the build on any new unguarded enforcement site — the same mechanism `TENANT-PROFILE-SWITCH.md §2.2` uses for budget modes.
5. **Reviewer panel, review-until-clean.** This design is reviewed by an independent panel (domain/finance, database, architecture) before it reaches the owner. Every code slice is reviewed per PR, re-reviewed after fixes, until clean — never merged on a single pass, never self-reviewed by its author.

---

## 0. Findings that shape the brief (as-is, with evidence)

1. **The grants module is grant-GIVING, not grant-RECEIVING.** `services/grant-service` is real and fully wired (web/mobile/gateway), but it models a grant-making body disbursing to beneficiaries: `scheme.grant_schemes` (budget/disbursed), `application.grant_applications`, `disbursement.grant_installments`, `utilisation.grant_uc_statements` (UC submitted *by the grantee*). There is **no entity for a grant the org receives** — no funder/donor master, no sanction-condition/restricted-purpose flag, no grant→GL fund linkage. finance-service consumes `grant.uc.submitted` (`finance-service/src/modules/integrations/consumer.ts:352-374`) but only emits `uc_reconciled` + an audit row; it posts **no journal**. Live: 61 grant schemes exist (grant-giving).
2. **FCRA: nothing in code.** The only trace is an unwired rule-pack label `{"audit_profile":"fcra_12a_80g"}` on the `small_office` org_profile (`admin-service/migrations/0026_erp_composition_registry.sql:119-127`), which is itself mislabelled "Section-8 Company" (`0025_module_composition.sql:120`). No FCRA registration field, no designated FC bank account, no foreign-source flag, no FC-4 return, no admin-expense cap. The "FCRA Foreign Contribution Unutilised" head exists **only in the design** (`TENANT-PROFILE-SWITCH.md §2.3` nonprofit table), consumed by nothing.
3. **No fund-accounting concept.** GL journal lines carry `legal_entity_id`, `cost_center_id`, `profit_center_id` (`finance-service/migrations/0028_journal_org_refs.sql`) but **no fund dimension**. The only fund-like head is the single hard-coded `ACCUMULATED_FUND` (code 3100, equity; `gl/system-heads.ts:20-23`), into which year-end rolls the whole net surplus (`year-end/repo.ts:73-114`). No corpus/restricted/designated funds, no per-fund balances, no inter-fund transfer, no release-from-restriction. `gl.finance_settings.coa_template` (CHECK `govt|commercial|nonprofit`) exists but is **inert** — nothing branches on it (`approvals/domain.ts:72-73`, read only by its own repo).
4. **12A/80G/donations/CSR: nothing.** No donor master, no 80G receipt generation/numbering, no 12A/80G registration/validity, no Form 10BD/10BE, no CSR-1/CSR-2. (`crm-service/.../section8-routes.ts` is a *naming collision* — a CRM gap-ledger section, irrelevant.)
5. **Financial-statement routes exist but the shapes are wrong for a nonprofit ICAI set.** `finance-service/src/modules/financial-statements/routes.ts` has trial-balance (:52), balance-sheet (:85, surplus folded to equity :123), profit-and-loss aliased `income-expenditure` (:148-195), receipts-payments (:198-220, only cash/bank *totals* from `gl.finance_cash_book`), cash-flow (:223). But: R&P is not by-head; there is no fund-wise column anywhere; no Corpus/Restricted/Unrestricted presentation; no notes/schedules/comparatives. The web UI doesn't even call these routes (`StatementsTable.tsx` says the R&P tab "cannot identify cash/bank heads").
6. **The nonprofit profile placeholder exists but is inert.** `packages/tenant-profile/src/index.ts:86-90`: `section8` → family `nonprofit`, `coaTemplate:"nonprofit"`, `statutoryPack:"nonprofit_in"`, `bundleCode:"section8"`, **`active:false`**. `profileCode` propagation is WIRED (tenant-service consumer/events/onboard), but the nonprofit **COA heads, template-keyed seeding (`seedGlHeadsTx`), the `nonprofit_in` reader, and the admin `section8` bundle are all UNBUILT** (the tenant-profile doc's slices S4+). There is no `section8` row in `admin-service/migrations`.
7. **One live `section8` tenant already exists:** "Digital India Corporation" (DIC), `edition=section8`, composition profile `small_office`, created 2026-11-09. The live tenant DB lacks the `profile_code` column (migration 0035 not deployed). This tenant is the real pilot target for this segment and the HR companion design's reference tenant.

---

## 1. Relationship to the two designs this sits between

- **Depends on (does not own):** tenant-profile slices **S0–S1** (merged: package + `profile_code`), **S4** (nonprofit COA template heads + template-keyed `seedGlHeadsTx`), **S5** (admin `section8` module bundle), and `section8.active=true`. S4/S5 are the prerequisite; until they land, a `section8` tenant seeds govt heads. This design assumes S4/S5 are built first (or folds the nonprofit-specific parts of S4 into slice NF-1 below if the owner wants them together).
- **Companion (does not overlap):** the HR/payroll `section8-design.md` (G1–G7: CTC breakup, payroll components, org leave, grade bands, contract fields, bulk import, project costing). No shared tables except migration-number coordination.
- **Owns (net-new, this document):** funds, FCRA, donations/80G/CSR, grants-received, and the nonprofit ICAI statement set.

---

## 2. Gap NF-1 — Fund accounting (the foundation; largest)

**Why first:** FCRA ring-fencing, restricted grants, corpus, and the nonprofit balance sheet all need a *fund dimension*. Without it, everything else is cosmetic.

### 2.1 Current state
One hard-coded `ACCUMULATED_FUND` head (`gl/system-heads.ts:20-23`); year-end rolls all net surplus into it (`year-end/repo.ts:73-114`). Journal lines have cost-centre/profit-centre dimensions but no fund (`migrations/0028_journal_org_refs.sql`). `coa_template` column inert (finding 3).

### 2.2 Target behaviour (configurable)
- A **fund master** per tenant: `{ code, name, type ∈ (corpus|restricted|unrestricted|designated), fcra ∈ (bool), source_condition (text), opening_balance, active }`. Types and whether funds are enforced are **config**, not edition-forked.
- A **fund dimension on every GL posting line** (nullable; required only when `NONPROFIT_FINANCE_ENABLED` and the tenant has ≥1 non-default fund). Govt tenants: column stays NULL, behaviour unchanged.
- **Per-fund trial balance, I&E and balance sheet** (feeds NF-6).
- **Inter-fund transfer** journal (a maker-checker transaction moving between funds, audited).
- **Release from restriction**: moving a restricted fund's spent portion to unrestricted when its condition is met (audited, reversible only by correction journal).
- **Year-end per fund**: surplus/deficit rolls into *that fund's* accumulated head, not one global head.

### 2.3 Data model (finance migration; number TBD at build)
- `gl.funds` (tenant, code, name, type, fcra bool, source_condition, status). RLS as every finance table.
- `gl.finance_journal_lines` gains `fund_id uuid NULL REFERENCES gl.funds(id)` — additive, nullable, no backfill.
- `gl.fund_balances` as a materialised projection (or computed on read for v1).
- Default fund `GENERAL` (unrestricted) auto-created for a nonprofit tenant at onboard; govt tenants get none.

### 2.4 APIs & screens
- `POST/GET /v1/finance/funds`, `POST /v1/finance/funds/:id/transfer`, `POST /v1/finance/funds/:id/release`. Fund picker on the voucher/journal entry screens, visible only when funds exist. Fund-wise statement filters (NF-6).

### 2.5 Tests
- **Golden:** a govt tenant's postings and year-end are byte-identical with `fund_id` NULL and the flag off AND on. (isolation contract #4)
- Fund-wise TB balances to zero; inter-fund transfer nets to zero; restricted spend cannot exceed restricted balance; release moves exactly the released amount.
- Migration test: add `fund_id` to a populated DB → existing rows NULL, existing reports unchanged.

### 2.6 Effort: ~5 d. **Risks:** touches the central posting path — golden pins first; a missing enforcement site leaves a hard refusal, so the mode helper + call-site grep test from the tenant-profile doc apply here too.

---

## 3. Gap NF-2 — Nonprofit COA template materialisation

### 3.1 Current state
`coa_template` inert; `standardGlHeads()` (`gl/standard-heads.ts:42-98`) has only govt heads; `ACCUMULATED_FUND` the only fund-ish head. The nonprofit template is design-only (`TENANT-PROFILE-SWITCH.md §2.3`). No `seedGlHeadsTx(template)` exists — onboard calls template-blind `seedStandardGlHeadsTx` (`tenant-onboard/consumer.ts:47`).

### 3.2 Target
Materialise the nonprofit template exactly as the tenant-profile doc specs it (corpus 3000, restricted/designated 3200, grants receivable 1550, unutilised grants 2300, **FCRA unutilised 2310**, grants/donations received 4400, membership 4410, programme expenses 5400 = default bill head, staff costs 5410, admin 5420, fundraising 5430, grants disbursed 5440, bank charges 6200). Codes obey existing nature rules (`head-nature.ts`). Seeding is template-keyed, add-only, idempotent. This **is** the nonprofit half of the tenant-profile S4 slice — coordinate so it is built once, not twice.

### 3.3–3.7 Data model / APIs / tests / effort
Reuse S4's `seedGlHeadsTx(tx, tenant, template, packs)`. Snapshot test: `seedGlHeadsTx(nonprofit)` equals the spec table; `govt` snapshot stays byte-identical. Default bill head for `section8` resolves to 5400, not the hard-coded 2202 fallback (`gl/standard-heads.ts:82-83` → `templateDefaultBillHead`). **Effort:** ~2 d on top of S4 (mostly the head list + tests).

---

## 4. Gap NF-3 — FCRA

### 4.1 Current state
Nothing (finding 2).

### 4.2 Target (configurable; all thresholds VERIFY with counsel/CA)
- **FCRA registration master** on the tenant: registration number, validity, **designated FC bank account** (FCRA 2020 mandates a single designated account at SBI New Delhi Main Branch — **VERIFY** still current), utilisation account(s).
- **Foreign-source ring-fencing:** a receipt marked foreign-source posts to an FCRA fund (NF-1) and the `2310 FCRA Unutilised` head; FCRA funds cannot be mixed with local funds in a payment (a transfer between them is refused). This is enforced via the **fund master's `fcra` flag**, not a tenant-type check.
- **Admin-expense cap:** an advisory/blocking warning when administrative expenses exceed the statutory share of FCRA spend (the cap is a **config figure**, default **VERIFY** — historically 20%). Mode (advisory|block) reuses the budget-control pattern.
- **FC-4 annual return** and a **quarterly foreign-contribution receipt disclosure** as report exports (data shaping, not filing integration).

### 4.3–4.7
Tables: `finance.fcra_registration`, FCRA designation on `gl.funds`. Reports reuse `packages/render`/voucher-print. Tests: foreign receipt lands in FCRA fund; cross-fund FCRA payment refused; admin-cap warning fires at the configured ratio. **Effort:** ~4 d. **Dependency:** NF-1 (funds).

---

## 5. Gap NF-4 — Donations, 12A/80G, CSR

### 5.1 Current state
Nothing (finding 4).

### 5.2 Target
- **Donor master:** name, PAN, address, donor type (individual|company|CSR|foreign), 80G-eligibility.
- **Donation receipt** with **80G-compliant numbering** (reuse `packages/numbering`) and a receipt PDF (reuse `voucher-print/documents.ts`), linked to a fund (NF-1) and a donor. Anonymous/cash-limit rules are config.
- **12A/80G registration** on the tenant: URN, validity, re-registration dates (the 10A/10AB regime — **VERIFY** current cycle).
- **Form 10BD** (annual statement of donations) + **10BE** (donor certificate) exports — data shaping to the prescribed schema. **VERIFY** current schema.
- **CSR:** CSR-1 registration field; CSR funds received post to a designated CSR fund; a CSR-2-style utilisation export. **VERIFY**.

### 5.3–5.7
Tables: `finance.donors`, `finance.donation_receipts`. All exports are report endpoints, no third-party filing integration in v1. Tests: receipt numbering is gapless and 80G-gated; 10BD export totals reconcile to donation receipts for the FY; a non-80G tenant sees none of this (flag off). **Effort:** ~4 d. **Dependency:** NF-1.

---

## 6. Gap NF-5 — Grants received (funder side)

### 6.1 Current state
`grant-service` is grant-giving only (finding 1); finance reconciles UCs by event+audit, posts no journal.

### 6.2 Target — decision required (owner Q)
A **grant-received** model: a grant the org *receives* with funder, sanction reference, **restricted purpose linked to a fund (NF-1)**, instalment schedule, and **utilisation reporting back to the funder** (reusing the UC period pattern `YYYY-YY`/`YYYY-MM` that already exists). On receipt → posts to the restricted fund + `1550 Grants Receivable`/`2300 Unutilised Grants`; on spend → draws the fund; UC export reconciles released vs utilised vs balance.
- **Option A (recommended):** a small new `grants-received` module in finance-service, reusing grant-service's UC *shapes* but owning the funder-side tables. Keeps grant-service (grant-giving) untouched — no cross-contamination.
- **Option B:** extend grant-service with a `direction` (giving|receiving). Rejected for v1: risks regressing the wired grant-giving flow (isolation contract #4).

### 6.3–6.7
Tables: `finance.grants_received`, `finance.grant_received_utilisation`. Posting via NF-1 funds. Tests: receipt→fund posting; over-utilisation refused; UC export reconciles; **grant-giving flow byte-identical** (regression). **Effort:** ~4 d. **Dependency:** NF-1.

---

## 7. Gap NF-6 — Nonprofit financial statements (ICAI format)

### 7.1 Current state
Routes exist but shapes are wrong (finding 5); web doesn't call them.

### 7.2 Target
- **Receipts & Payments** by **head and bank/cash account**, opening/closing per account (needs cash-book rows to carry head + fund — a cash-book enrichment).
- **Income & Expenditure**, **fund-wise columns**, with schedules and **previous-year comparatives**.
- **Balance Sheet** presenting **Corpus / Restricted / Unrestricted / Designated** funds separately (from NF-1), liabilities incl. `2310 FCRA Unutilised`/`2300 Unutilised Grants`, with notes/schedules.
- An **accounting-basis-aware** output (cash vs accrual; the setting exists at `approvals/apply.ts:184-234`).
- A **separate FCRA statement** (foreign receipts & utilisation).

### 7.3–7.7
Fix the existing routes' shapes and add fund-wise grouping; add a cash-book head/fund tag (additive). Build the web views that are currently missing. Tests: R&P by head reconciles to the cash book; fund-wise BS fund columns sum to total funds; govt tenant's existing statement output unchanged. **Effort:** ~5 d. **Dependency:** NF-1 (fund columns), NF-2 (heads).

---

## 8. Onboarding & wizard for `section8`

- Activate `section8` (`active:true`) **only after** NF-1/NF-2 and S5 land; gated by `TENANT_PROFILES_ENABLED` + `NONPROFIT_FINANCE_ENABLED`.
- Setup wizard (reuse `apps/web/.../setup`): capture **CIN / Section 8 licence, PAN, 12A/80G URN + validity, FCRA registration (if any) + designated account**, and the fund opening balances. These are additive wizard steps visible only for the nonprofit profile (same visibility mechanism `govt_small_office` uses for its DDO step).
- Admin `section8` module bundle (S5): the §8 bundle in the tenant-profile doc minus govt-only modules, plus `grant`/donation/fund screens. Enforcement starts `shadow`, flips to `enforce` after soak.

---

## 9. Backward compatibility & flags (the isolation proof)

- Two flags, both default false: `TENANT_PROFILES_ENABLED` (existing), `NONPROFIT_FINANCE_ENABLED` (new, per-tenant).
- Every existing tenant: `fund_id` NULL, `coa_template='govt'`, no donor/FCRA/fund rows → identical behaviour.
- Regression suite proving govt/PSU/MSME byte-identical with flags off AND on (contract #4). CI grep test for unguarded enforcement sites.
- Migration numbers coordinated with #2468 (finance 0162/0166 already taken) and the HR companion (payroll 0166, hrms 0266) — re-grep at build.

---

## 10. Implementation plan (PR-sized slices, in order)

| # | Slice | Depends | Effort |
|---|---|---|---|
| NF-0 | Flag `NONPROFIT_FINANCE_ENABLED` + regression golden pins (govt/PSU/MSME) | — | 1 d |
| NF-1 | Fund master + fund dimension + transfers/release + per-fund year-end | NF-0 | 5 d |
| NF-2 | Nonprofit COA template materialisation (the nonprofit half of S4) | S4, NF-1 | 2 d |
| NF-3 | FCRA registration, ring-fencing, admin cap, FC-4/quarterly exports | NF-1 | 4 d |
| NF-4 | Donor master, 80G receipts, 12A/80G registration, 10BD/10BE, CSR | NF-1 | 4 d |
| NF-5 | Grants-received module (Option A) + funder UC | NF-1 | 4 d |
| NF-6 | Nonprofit ICAI statement set (R&P/I&E/BS fund-wise + FCRA statement) | NF-1, NF-2 | 5 d |
| NF-7 | `section8` activation + wizard + admin bundle (S5) | all above | 2 d |

~27 dev-days. NF-0/NF-1 are the critical path; NF-3/NF-4/NF-5 parallelise once NF-1 lands. Build only after sign-off, after foundation S4/S5.

---

## 11. What to reuse (so we don't rebuild)
- `packages/tenant-profile` (profile catalogue, flag, resolver); `gl.finance_settings` + `coa_template` column; `approvals` maker-checker + change-request machinery.
- grant-service UC *shapes/period patterns* (`utilisation/*`) — copied, not extended.
- `packages/numbering` (receipt series), `packages/render` + `voucher-print/documents.ts` (PDFs).
- `financial-statements/routes.ts` (reshape, don't rewrite); `year-end` rollover (make per-fund).
- Cost-centre/profit-centre dimension plumbing (model the fund dimension the same way).
- Audit/outbox helpers, RLS patterns, setup-wizard visibility.

---

## 12. Open questions for the owner
1. **Build NF-2 as part of tenant-profile S4, or here?** (Recommend: build the nonprofit COA once, in S4, so there's one seeding function.)
2. **Grants-received: Option A (new module, recommended) or B (extend grant-service)?**
3. **FCRA scope for v1:** full ring-fencing + admin cap + FC-4 export, or registration + designated-account + ring-fencing only (defer FC-4 to v2)?
4. **80G/10BD scope for v1:** receipts + numbering + 10BD export, or receipts only (defer statutory exports)?
5. **Statutory figures to confirm (VERIFY):** FCRA admin-expense cap %; designated-account rule; 12A/80G re-registration cycle; 10BD/10BE/CSR-1/CSR-2 current schemas. Who signs these off (CA/counsel)?
6. **Reference tenant:** is DIC (the one live `section8` tenant) the pilot for this segment, and does its finance team confirm fund structure + opening balances?
7. **Accounting basis:** the `section8` placeholder is `accrual`. Confirm DIC runs accrual (not cash) for v1.

---

## 13. Cross-cutting risks
1. Statutory correctness is the gating risk; every figure is config with an effective date and a named reviewer. Nothing here is a statement of law.
2. NF-1 touches the central posting path; govt goldens pinned first, byte-identical, flags off and on.
3. Shared-host constraint: any DIC dry run uses a DB copy, not the live UAT stack, and obeys the memory/vitest-worker guidance (the 14 Nov host-exhaustion lesson).
4. Migration-number and flag-default coordination across #2468, the HR companion, and this design.
5. Data migration of the DIC tenant (fund setup, opening balances) happens only through product routes, only after sign-off.
6. Scope: FCRA/80G filing *integrations* (actual portal submission) are explicitly out of v1 — exports only.
