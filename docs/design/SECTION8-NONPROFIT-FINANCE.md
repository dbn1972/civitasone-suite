# Section 8 (non-profit) segment — nonprofit finance layer: paper design

**Status:** DESIGN for review — **revision 2**, after a 3-lens reviewer panel (architecture/isolation, domain/compliance, database). No code. Companion to `~/orch-logs/segments/section8-design.md` (HR/payroll/leave/costing), which explicitly defers this layer. This document is that deferred separate design. The panel's dispositions are logged in §14.

**Source:** repo `~/CivitasOne/civitasone-suite` at `origin/main` (`730f7558d`), read-only; the tenant-profile design `docs/design/TENANT-PROFILE-SWITCH.md` (PR #2467) and its merged S0–S3 code (#2468); an as-is map and a reviewer panel, 15 Nov 2026. Line numbers are from `origin/main` and will drift — re-grep before coding.

**Constraint:** parallel work, OFF the UAT server until the 18–20 Nov screen sign-off. Everything ships behind flags defaulting **false**; a merge after sign-off changes nothing until a flag is turned on per tenant.

**VERIFY** marks a statutory/legal figure or rule not confirmed from an authoritative source (panel WebSearch did not return authoritative sources; these come from knowledge). No sentence here states current law; every threshold is configuration with an effective date and a named reviewer, confirmed by a CA/counsel before build.

---

## Cross-cutting contract (read first): configurable rules & tenant isolation

Owner instruction, 15 Nov: *reviewers always; no violation of other tenant types; establish configurable rules.* This frame is non-negotiable.

1. **Data-keyed, never edition-forked.** No business-logic branch reads `edition`, `profileCode` or `family` to decide behaviour. Behaviour is decided by **stored configuration** resolved into each service's own tables: the profile catalogue only *seeds* settings at onboard; thereafter `gl.finance_settings` (`accounting_basis`, `budget_control`, `coa_template`, and the new `fund_accounting`), the fund master, and the statutory pack decide everything. **Enforcing test (new):** a lint test fails CI if any file under `finance-service/src/modules/{gl,year-end,financial-statements}` imports `getProfile`/`PROFILES` or reads `edition`. That is the real teeth behind this rule.
2. **Per-tenant flag with a real home.** `fund_accounting ∈ (off|on)` is a **column on `gl.finance_settings`** (and a field on `ProfileSettings`), defaulting `off` in `LEGACY_SETTINGS` and the govt/commercial profiles, `on` for `section8`. It is resolved **once per posting from the already-loaded settings row** — no env var, no hot-path row-count lookup. This mirrors how `budgetControl`/`accountingBasis` already work (`approvals/domain.ts`). The global `TENANT_PROFILES_ENABLED` still gates whether any non-legacy profile activates at all.
3. **Additive-only, lock-safe.** New tables; new **nullable** columns (metadata-only `ADD COLUMN`); FKs added `NOT VALID` then `VALIDATE CONSTRAINT` separately under `SET lock_timeout`; indexes built `CONCURRENTLY` and **partial** (`WHERE fund_id IS NOT NULL`) so govt tenants carry one nullable column and no index-maintenance cost. GL heads seeded `ON CONFLICT (tenant_id, code) DO NOTHING`. No row rewrite, no head rename/move, no govt-reachable function changes its signature or default (fund-aware logic is new functions, selected by settings).
4. **Proven isolation, not asserted.** Golden tests compare **full ledger rows, trial balance, I&E, Balance Sheet and year-end output JSON** for a seeded govt tenant, before and after the migration, flags off AND on — byte-identical. A **call-site guard** (a CI grep, built as an NF-0 deliverable — it does **not** exist today) asserts every ledger/journal write goes through one `fundContext()` seam. Cross-tenant test: a `section8` and a govt tenant in one DB; the govt tenant sees no funds/donors/FCRA rows (RLS) and `/v1/finance/funds` returns 404/403 when `fund_accounting` is off.
5. **Fail-closed.** If `fund_accounting` is on but the nonprofit heads/funds are absent (e.g. profile activated before S4/S5), posting is **refused**, never silently defaulted to govt heads.
6. **Reviewer panel, review-until-clean.** This design was reviewed by three independent lenses before reaching the owner (§14). Every code slice is reviewed per PR and re-reviewed after fixes, until clean; never one-shot, never self-reviewed.

---

## 0. Findings that shape the brief (as-is, evidence re-verified by the panel)

1. **grant-service is grant-GIVING, not grant-RECEIVING.** Fully wired (web/mobile/gateway); models a grant-making body disbursing to beneficiaries. finance consumes `grant.uc.submitted` (`finance-service/src/modules/integrations/consumer.ts:352-374`) emitting only `uc_reconciled` + an audit row — **no journal**. No funder/donor master, no grant→fund linkage. (Confirmed by all three reviewers.)
2. **The books of record are `gl.finance_ledger`, not journal lines.** Trial balance, Balance Sheet, I&E and year-end all read `gl.finance_ledger` (`0001_init:114`; `year-end/repo.ts:43,123,151` `ledgerMovements`). `finance_ledger` has only `head_id, debit_minor, credit_minor, voucher_no, posting_date` — **no journal link, no dimensions**. The org dimensions (`legal_entity_id, cost_center_id, profit_center_id`) are on the **journal header** `gl.finance_journals` (`0028_journal_org_refs.sql`), **not** on lines. `gl.finance_journal_lines` (`0030`) is a denormalised CQRS read-model of the `finance_journals.lines` JSONB, read by `simplified/queries.ts` only. *(Correction of r1: the fund dimension must live on `finance_ledger` + the JSONB line shape + opening balances — see §2.)*
3. **Append-only by trigger.** `finance_ledger` and journal `lines` are immutable (`0014`: `trg_ledger_no_mutate`). So `fund_id` cannot be backfilled/corrected after posting; "release from restriction" and "inter-fund transfer" are **new journals**, never edits; a line posted without a fund can never be fixed — enforcement at post time must be exact.
4. **No fund concept.** One hard-coded `ACCUMULATED_FUND` head (3100, env-overridable; `gl/system-heads.ts:23`); year-end rolls the whole net surplus into it (`year-end/repo.ts`). `gl.finance_settings.coa_template` (CHECK govt|commercial|nonprofit) exists but is inert. No corpus/restricted/designated funds, no per-fund balances, no inter-fund transfer.
5. **FCRA / 12A / 80G / CSR: nothing in code.** Only an unwired rule-pack label `fcra_12a_80g` on the mislabelled `small_office` org_profile (`admin 0026`). The "FCRA Unutilised" head exists only in the tenant-profile design. (Confirmed.)
6. **Statement routes exist, shapes wrong.** `financial-statements/routes.ts` has trial-balance, balance-sheet (surplus→equity :123), p&l aliased income-expenditure, receipts-payments (cash/bank **totals** only), cash-flow. No fund-wise column, no Schedule III structure, no notes/schedules/comparatives; web doesn't call them.
7. **The nonprofit profile is an inert placeholder.** `packages/tenant-profile/src/index.ts:86-90`: `section8` → `nonprofit`/`nonprofit_in`/`active:false`. `profileCode` propagation WIRED; nonprofit COA heads + template-keyed `seedGlHeadsTx` + `nonprofit_in` reader + admin `section8` bundle **UNBUILT** (tenant-profile S4+). Onboard still seeds govt heads template-blind (`tenant-onboard/consumer.ts:47`).
8. **The pilot tenant reframes scope.** The one live `section8` tenant is **Digital India Corporation (DIC)**, a MeitY-sponsored Section 8 company **funded by government grants-in-aid** — so **FCRA and 80G donations may not apply to it**. The missing *core* case for DIC is **government grants-in-aid accounting** (§3). `profile_code` is not on the live DB (0035 not deployed).
9. **Global/shared tables to avoid.** `budget.finance_major_heads` is GLOBAL (no RLS, `0035`); nonprofit GL heads must go **only** in per-tenant `gl.finance_heads` (`(tenant_id, code)` unique). `FINANCE_*`/`PAYROLL_GL_*` head codes are process-global env vars; new nonprofit codes (2300/2310/4400/5400…) must be resolved from template data and checked for clash at seed time.

---

## 0.5 Which regimes apply — the decision that gates v1 scope (NEW, owner question #1)

A "Section 8 company" is **not** one accounting profile. The applicable regime depends on how the entity is funded. The owner + DIC finance must confirm which of these apply before scope/estimate is fixed:

| Regime | Trigger | What it needs | Likely for DIC? |
|---|---|---|---|
| **Government grants-in-aid** (§3) | Funded by govt grants-in-aid (GFR) | Grant categories (salary/general/capital-asset), GFR-form UCs, refund of unspent + interest earned, AS 12 capital-grant accounting | **Yes — the core case** |
| **FCRA** (§5) | Receives foreign contribution | Registration, designated FC account, ring-fenced FC fund + books, admin-expense cap, FC-4 | Only if DIC takes foreign funds — **confirm** |
| **80G donations** (§4) | Takes public donations, offers 80G | Donor master, 80G receipts, Form 10BD/10BE | Only if DIC takes donations — **confirm** |
| **CSR as implementing agency** (§6) | Receives CSR funds from companies | CSR-1 registration, restricted project funds, UC to donor company (CSR **not** 80G-deductible) | Confirm |

**Recommended v1 if DIC is the pilot:** NF-0, NF-1 (funds), NF-2 (nonprofit COA), **NF-3 (govt grants-in-aid)**, NF-7 (Schedule III statements), and *registration masters only* for FCRA/12A-80G. Donations/FCRA/CSR *flows* become v2 unless DIC confirms it takes that money. The whole segment design still covers all regimes (for later Section 8 tenants); the *build order* is driven by DIC's actual regimes.

---

## 1. Relationship to the two designs this sits between
- **Depends on (does not own):** tenant-profile **S0–S1** (merged), **S4** (template-keyed `seedGlHeadsTx` — owns the *mechanism*), **S5** (admin `section8` bundle), `section8.active=true`. Until S4/S5 land, a `section8` tenant seeds govt heads; §9 fail-closed prevents posting in that state.
- **Companion (no overlap):** the HR/payroll `section8-design.md` (G1–G7). Migration-number coordination only (numbering is per service, so payroll 0166 and finance 0166 do **not** collide).
- **Owns:** funds, govt grants-in-aid, grants/donations received, FCRA, CSR-as-agency, and the Schedule III statutory statement set.

---

## 2. Gap NF-1 — Fund accounting (foundation; REWRITTEN per panel)

**Why first:** grants-in-aid restriction, FCRA ring-fencing, restricted/corpus funds and fund-wise statements all need a fund dimension on the books of record.

### 2.1 Current state
§0 findings 2–4: books of record = `finance_ledger` (no dimensions, append-only); funds don't exist; `coa_template` inert.

### 2.2 Target (configurable, resolved from settings)
- **Fund master** `gl.funds`: `{ code, name, type ∈ (corpus|restricted|unrestricted|designated), fcra bool, source_condition, status }`.
- **`fund_accounting` resolved once per posting** from `gl.finance_settings` (§contract #2). When on, **every** ledger line carries a fund; default is the auto-created `GENERAL` (unrestricted) fund. When off, `fund_id` is NULL and every query treats NULL as GENERAL via one shared `COALESCE(fund_id, <tenant GENERAL id>)` helper — so pre-flag history and govt tenants land in GENERAL, never a missing bucket.
- **Per-fund trial balance, I&E, Balance Sheet** (feeds NF-7); **inter-fund transfer** and **release-from-restriction** as new maker-checker journals (§0 finding 3).
- **Per-fund year-end**: a **new** `fundYearEndRollover` selected by settings — the existing `rollForward` is left untouched for govt.

### 2.3 Data model (finance migration 0169+ — re-check the next free number at build; origin/main is at 0168)
- **`gl.funds`** (new): columns above; `CHECK (type IN (...))`, `CHECK (status IN (...))`; `UNIQUE (tenant_id, id)` and `UNIQUE (tenant_id, code)`; **ENABLE + FORCE ROW LEVEL SECURITY** with the standard `USING/WITH CHECK (tenant_id = budget.current_tenant_id())` policy and `GRANT … TO finance_svc` (RLS is per-table, not inherited). `fcra` and `type` are **immutable after first posting to the fund** (COA-template-lock style).
- **`gl.finance_ledger`** gains `fund_id uuid NULL` — the books of record. Added `NOT VALID` FK `(tenant_id, fund_id) REFERENCES gl.funds(tenant_id, id)` then `VALIDATE` separately (a bare `REFERENCES funds(id)` would bypass RLS and leak cross-tenant — use the **composite tenant-scoped FK**).
- **`gl.finance_journals.lines` JSONB** element gains `fundId`; **`gl.finance_journal_lines`** gains `fund_id` — both written from the **same** source as the ledger line, so the three never drift. The posting-path writer is `gl/consumer.ts` (journal insert ~:394, `insertLedgerLine` ~:410, second path ~:780) — the `fundContext()` seam wraps all of them.
- **`gl.finance_opening_balances`** gains `fund_id`; replace `UNIQUE (tenant_id, fy_code, account_code)` with a unique index on `(tenant_id, fy_code, account_code, COALESCE(fund_id, '000…0'))` (additive — existing NULL rows don't collide). Year-end (`openingForFy`, `fyBalances`, `rollForward`, and the delete/reinsert at `repo.ts:231`) groups by `(head, fund_id)`.
- **No `gl.fund_balances` table in v1** — balances are **computed-on-read** (`SUM` by fund over the append-only ledger; stable, reconcilable), using the partial index below. (If ever materialised, a rebuildable cache keyed `(tenant,fund,head,fy)`, never a source of truth.)
- **`gl.finance_cash_book`** gains a nullable `fund_id` + head tag (for NF-7 R&P), written only when `fund_accounting` on.
- **Indexes:** partial, `CREATE INDEX CONCURRENTLY … (tenant_id, fund_id, head_id, posting_date) WHERE fund_id IS NOT NULL` on `finance_ledger` and `finance_journal_lines`. No plain `(tenant_id, fund_id)` index (NULL-heavy govt rows would bloat writes).

### 2.4 Per-fund balancing (panel B3)
A journal can balance overall yet be unbalanced within a fund. Enforce via **paired due-to/due-from heads** (transfer shape: `Dr fund-A / Cr DueTo-B` + `Dr DueFrom-A / Cr fund-B`) **and** a second deferred constraint check per `(journal_id, fund_id)` that applies only when any line has `fund_id NOT NULL` (extends `0072b gl.check_journal_balance`). Restricted-spend "cannot exceed balance" uses `SELECT … FOR UPDATE` on the fund row (or an advisory lock keyed by `fund_id`) inside the posting tx to avoid a read-then-write race.

### 2.5 Tests
Golden (full rows/TB/I&E/BS/year-end JSON, govt, flags off AND on, byte-identical); fund TB nets to zero per fund; transfer nets to zero; restricted overspend refused under concurrency; migration test asserts `finance_ledger` accepts the column under the append-only trigger and old rows unchanged; cross-tenant RLS test.

### 2.6 Effort: **~7–8 d** (ledger + JSONB + opening balances + year-end regroup + balancing + statements wiring). **Risks:** central posting path — golden pins first; fail-closed; `fundContext()` seam + call-site guard.

---

## 3. Gap NF-3 — Government grants-in-aid (the DIC core case; NEW)

### 3.1 Why
DIC is funded by govt grants-in-aid; this, not donations/FCRA, is the primary v1 case (§0.8, §0.5).

### 3.2 Target (all **VERIFY** with the sanction terms / GFR)
- **Grant-in-aid categories:** salary, general, capital-asset-creation — each a restricted fund (NF-1) with its sanction reference and conditions.
- **Utilisation certificates in the GFR-prescribed form** (GFR 12A/19A — **VERIFY** current form numbers) reconciling sanctioned vs released vs utilised vs unspent.
- **Refund of unspent balance + interest earned on the grant** (interest on grants-in-aid is typically remittable/adjustable — **VERIFY**): track interest attributable to each grant fund; refund/adjust flows.
- **Capital-grant accounting under AS 12** (**VERIFY**): capital grants either as deferred income released to I&E over asset life, or as an asset fund — owner/CA to choose the policy.

### 3.3–3.7 Data model / APIs / tests / effort
Reuse NF-1 funds + grant-received tables (NF-4). Tables: `finance.grants_in_aid`, `finance.grant_utilisation`. UC export reuses `packages/render`. Tests: category→fund posting; UC reconciles; unspent+interest refund; AS-12 release schedule. **Effort:** ~4–5 d. **Dependency:** NF-1.

---

## 4. Gap NF-4 — Grants/donations received, 12A/80G (conditional on DIC taking donations)

- **Grants-received (funder side)** — **Option A (recommended): a new finance module**, reusing grant-service UC *shapes* but owning funder-side tables; grant-service left byte-identical (its `grant.uc.submitted` handler unchanged). Option B (extend grant-service with a direction flag) rejected: puts nonprofit logic in the wired grant-giving path.
- **Donations / 80G:** donor master (name, PAN, type ∈ individual|company|CSR|foreign, 80G-eligible); 80G-compliant **gapless-but-voidable** receipt numbering (`packages/numbering`) + PDF (`voucher-print`), linked to donor + fund; **Form 10BD** (annual donation statement) + **10BE** (donor certificate) exports (schema **VERIFY** — note the Income-tax Act 2025 may renumber 12A/80G/11-13 from 1 Apr 2026). 12A/80G registration/validity/renewal (10A/10AB) on the tenant. **CSR donors force 80G-eligible=false** (CSR isn't 80G-deductible).
- **Explicitly deferred (named, not v1):** 85%-application/accumulation tracking, corpus-with-direction, specified-persons/prohibited-investment rules, anonymous-donation tax, ITR-7/audit report, in-kind donations, pledges. **Effort:** ~4 d. **Dependency:** NF-1.

---

## 5. Gap NF-5 — FCRA (conditional on DIC receiving foreign contribution)
Registration + designated FC account (SBI New Delhi Main Branch — **VERIFY**; utilisation account may be another bank — **VERIFY**); **ring-fenced FC fund + separate FC books** (FC receipts/utilisation/balance-sheet for FC-4); **admin-expense cap measured on FC *received* in the FY** (20% since the 2020 amendment — **VERIFY** basis and what counts as admin expense), effective-dated config, advisory|block mode; interest/forex gains/FD earnings on FC funds are **FC income** (**VERIFY**); restrictions on sub-granting/transfer to non-FCRA entities; refund of unspent FC; registration/renewal (FC-3) + change-reporting tracking; quarterly receipts disclosure (channel **VERIFY**). Ring-fence check runs **inside the posting tx** so a direct journal route can't bypass it. **Effort:** ~4–5 d (FC-4/quarterly to v2). **Dependency:** NF-1.

---

## 6. Gap NF-6 — CSR as implementing agency (conditional; CORRECTED)
CSR-1 = **the agency's** registration (requires 12A/80G). **CSR-2 is filed by the donor company, not the agency — dropped as an output.** The agency's duties: **project-wise restricted CSR funds** (NF-1), utilisation certificates and reports **to the donor company**. CSR receipts post to a designated CSR fund; `donor_type=CSR` carries no 80G claim. **Effort:** ~2 d. **Dependency:** NF-1, NF-4.

---

## 7. Gap NF-7 — Statutory statements (Schedule III; CORRECTED)
A Section 8 **company** files **Schedule III**: Balance Sheet, Statement of Profit & Loss (= Income & Expenditure), Cash Flow, and Notes, under the applicable AS/Ind AS (AS 12 grants, AS 10/AS 26 — **VERIFY**), audited and filed with MCA (AOC-4, MGT-7). Lead with this set, **fund-wise** (Corpus/Restricted/Unrestricted/Designated from NF-1) + comparatives + notes/schedules. **Receipts & Payments** (trust/society format) and the **separate FCRA statement** are **supplementary**, not the company statutory set. Reshape the existing routes (don't rewrite); build the missing web views; add the cash-book head/fund tag (NF-1). Golden: govt tenant's existing statement output unchanged. **Effort:** ~5–6 d. **Dependency:** NF-1, NF-2.

---

## 8. Onboarding & wizard for `section8`
Activate `section8` only after NF-1/NF-2 + S4/S5; gated by `TENANT_PROFILES_ENABLED` + `fund_accounting` on. Wizard (reuse `apps/web/.../setup`) captures CIN/S8 licence, PAN, **applicable regimes** (§0.5), 12A/80G URN (if any), FCRA registration (if any) + designated account, and **per-fund opening balances**. Admin `section8` bundle (S5), enforcement `shadow`→`enforce` after soak.

---

## 9. Backward compatibility, flags & fail-safe
Two flags default off: `TENANT_PROFILES_ENABLED` (env, global activation) + **`fund_accounting` (settings column, per tenant)**. Existing tenants: `fund_id` NULL (=GENERAL at read), no fund/donor/FCRA rows → identical behaviour; govt golden byte-identical off AND on. Lint test bans `edition`/`getProfile` imports in finance posting modules. **Fail-closed:** `fund_accounting` on + heads/funds absent ⇒ refuse to post. **NF-8 activation is strictly last and per-tenant;** turning `fund_accounting` **off** is refused once any fund-tagged ledger row exists (append-only ledger makes it irreversible) — COA-template-lock style.

---

## 10. Implementation plan (PR-sized, in order; re-estimated)

| # | Slice | Depends | Effort |
|---|---|---|---|
| NF-0 | `fund_accounting` settings column + `ProfileSettings` field + `fundContext()` seam + **call-site grep guard (build it)** + lint test (no edition imports) + govt/PSU/MSME golden pins | — | **2–3 d** |
| NF-1 | Fund master + fund on ledger/JSONB/opening-balances + per-fund balancing + transfers/release + per-fund year-end (new fn) + computed-on-read balances + RLS/FK/partial-indexes | NF-0 | **7–8 d** |
| NF-2 | Nonprofit COA **content** (head list + tests) consuming S4's `seedGlHeadsTx`; never touch `finance_major_heads` | S4, NF-1 | 2 d |
| NF-3 | Government grants-in-aid (categories, GFR UC, unspent+interest refund, AS 12) | NF-1 | 4–5 d |
| NF-4 | Grants-received (Option A) + donor master + 80G receipts + 10BD/10BE (if DIC donates) | NF-1 | 4 d |
| NF-5 | FCRA (registration + designated account + ring-fence + admin cap; FC-4/quarterly → v2) | NF-1 | 4–5 d |
| NF-6 | CSR as agency (project funds + UC to donor) | NF-1, NF-4 | 2 d |
| NF-7 | Schedule III statutory set (BS/P&L/Cash Flow/Notes, fund-wise, comparatives) + R&P/FCRA supplementary | NF-1, NF-2 | 5–6 d |
| NF-8 | `section8` activation + wizard + admin bundle (S5), per tenant, last | all | 2 d |

**Total: ~32–37 core dev-days; realistically ~40–60 calendar days including per-PR review-and-re-review loops, regression pins, and the DIC dry-run** (the review loops the owner mandated are not free). **Excludes** the S4/S5 prerequisites and the DIC data dry-run. Critical path NF-0→NF-1→NF-7; NF-3/4/5 parallelise after NF-1. Build only after sign-off. **Scope is set by §0.5** — if DIC is govt-grants-only, NF-4/5/6 flows drop to v2 and v1 is ~20–28 core days.

---

## 11. What to reuse
`packages/tenant-profile`; `gl.finance_settings` + the `approvals` maker-checker/change-request machinery; grant-service UC *shapes* (copied); `packages/numbering`, `packages/render`/`voucher-print`; `financial-statements/routes.ts` (reshape); cost-centre plumbing (as a *pattern*, not the table — fund goes on the ledger, see §0.2); audit/outbox/RLS helpers; setup-wizard visibility.

---

## 12. Open questions for the owner (ordered)
1. **Which regimes apply to DIC — govt grants-in-aid / FCRA / 80G / CSR?** (§0.5) This sets v1 scope and the estimate. Everything else is secondary.
2. **AS 12 capital-grant policy:** deferred income released over asset life, or an asset fund?
3. **Grants-received:** Option A (new module, recommended) confirmed?
4. **Build NF-2 as the content half of tenant-profile S4** (recommended — one seeding mechanism), not duplicated here?
5. **Statutory figures to confirm (VERIFY), with a named CA/counsel:** GFR UC form numbers + interest-on-grant rule; AS 12/10/26 applicability; FCRA cap basis (received vs utilised) + designated-account rule; 12A/80G validity/renewal windows + 10BD/10BE schema; **Income-tax Act 2025 section renumbering from 1 Apr 2026**; CSR-1 requirements.
6. **Reference tenant:** is DIC the pilot, and does DIC finance confirm fund structure + opening balances + accrual (not cash) basis?
7. **v1/v2 split** (recommended in §0.5) approved?

---

## 13. Cross-cutting risks
1. Statutory correctness is the gating risk; every figure is effective-dated config with a named reviewer. Nothing here is a statement of law.
2. NF-1 touches the central posting path (`finance_ledger`, year-end); govt goldens pinned first, byte-identical, flags off and on; fund-aware logic is **new** functions selected by settings.
3. Shared-host constraint: any DIC dry run uses a DB copy, not the live UAT stack, obeying the vitest-worker memory guidance (14 Nov host-exhaustion lesson).
4. Migration-number + flag-default coordination across #2468, the HR companion, and this design (next free finance = 0169; re-check at build; per-service numbering doesn't cross-collide).
5. DIC data migration (fund setup, opening balances) only through product routes, only after sign-off.
6. Scope: statutory *filing integrations* (portal submission) are out of v1 — exports only. FCRA FC-4/quarterly, 10BD/10BE and CSR reports are v2 unless DIC's regimes require them in v1.

---

## 14. Reviewer panel disposition (revision 1 → 2)
Three independent lenses, 15 Nov. All verdicts APPROVE-WITH-CHANGES except the data model (NEEDS-REWORK on §2.3), now reworked.
- **Architecture/isolation:** confirmed the data-keyed/flags/additive frame; blockers fixed — fund on `finance_ledger` not journal lines (B1); `fund_accounting` as a settings column, no row-count branch (B2); grep guard built as NF-0 deliverable not claimed precedent; lint test banning edition imports; fail-closed; NF-2 = content slice on S4; NF-8 last + irreversible-off lock; `finance_major_heads` is global (don't insert there).
- **Domain/compliance:** Schedule III (not R&P) is the company statutory set (B1); FCRA cap on *received* (B2); CSR-1 is agency registration, CSR-2 is the donor's, CSR not 80G (B3); **DIC is govt grants-in-aid — added as the NF-3 core case and the gating owner question** (B4); Income-tax Act 2025 renumbering; v1/v2 split made explicit; estimate redone.
- **Database:** rewrote §2.3 — fund on `finance_ledger` + JSONB + opening-balances (unique-key change); per-fund balancing via due-to/due-from + deferred check; lock-safe DDL (`NOT VALID`+`VALIDATE`, `CONCURRENTLY`, partial indexes); tenant-scoped composite FK + `UNIQUE(tenant_id,code/id)`; explicit RLS/FORCE/GRANT; computed-on-read (no `fund_balances` table); `FOR UPDATE` on restricted spend; `NULL=GENERAL` COALESCE helper; next free finance migration 0169.
