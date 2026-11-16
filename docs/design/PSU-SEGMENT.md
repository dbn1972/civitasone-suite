# PSU (public sector undertaking) segment: paper design

**Status:** DESIGN for review. No code. Third in the segment roadmap (Section 8 → MSME → **PSU**). **Mostly reuse** of the MSME commercial design (COA, accrual, Schedule III) and the Section 8 HR work (CTC, pay-matrix, EPF, gratuity), plus a PSU-only government-ownership overlay. Mirrors `~/orch-logs/segments/section8-design.md` and the two finance designs (PR #2547 Section 8, #2549 MSME).

**Source:** repo `~/CivitasOne/civitasone-suite` at `origin/main` (`730f7558d`), read-only; an as-is map, 15 Nov 2026. Line numbers drift — re-grep before coding.

**Constraint:** parallel work, OFF the UAT server until the 18–20 Nov sign-off. Flags default **false**; a merge after sign-off changes nothing until a flag is turned on per tenant.

**VERIFY** marks a statutory/legal figure/rule not confirmed from an authoritative source. Every threshold is effective-dated config with a named reviewer (a company secretary / CA for PSU: DPE guidelines + Companies Act). No sentence states current law.

**Design-method note:** written after the Section 8 and MSME 3-lens reviews, so it pre-applies those lessons (settings-column gating never edition-forked; books-of-record `gl.finance_ledger`; heads in `budget.finance_heads` with a stored `statement_class`, never prefix-inferred; flags default off; additive/lock-safe; credible estimate). The same panel still runs on it.

---

## Cross-cutting contract (read first): configurable rules & tenant isolation

Owner standing rule: *reviewers always; no violation of other tenant types; configurable rules.* Identical to the Section 8 / MSME designs; not repeated in full. PSU-specific points:
1. **Data-keyed.** PSU behaviour is driven by stored settings — `coa_template='commercial'`, `accounting_basis='accrual'`, and new settings `pay_scheme='ida'`, `audit_profile`, `govt_owned=true`/`shareholding_pct` — resolved from the settings row, never a branch on `edition='psu'`. The admin-service composition `rule_packs` labels (`ida_cda`, `pms_prp`, `cag_dpe`, `commercial_accrual`, `psu_manual`) are **unread today**; they are either wired into real settings resolution or dropped — not left as dead labels (lint-test enforced, extended from MSME).
2. **Flags default off.** `TENANT_PROFILES_ENABLED` + per-tenant settings; `pay_scheme='ida'` gates IDA pay, `audit_profile='cag_dpe'` gates the CAG/CARO statement add-ons, `govt_owned` gates the shareholding/dividend module.
3. **Additive-only, lock-safe; proven isolation; fail-closed by classification; reviewer panel review-until-clean** — as the MSME design §contract 3–6. Golden tests prove govt/Section 8/MSME byte-identical with PSU flags off AND on.

---

## 0. Findings that shape the brief (as-is, with evidence)

1. **`psu` profile is an inactive govt placeholder.** `packages/tenant-profile/src/index.ts:76` = `legacyPlaceholder("psu","PSU / Board","psu")` → `family:govt`, `active:false`, `LEGACY_SETTINGS` (cash/mandatory/`govt`/`govt_in`). `effectiveSettings()` returns legacy for any inactive profile, so a PSU tenant behaves exactly as govt today. No `psu` value in `COA_TEMPLATES` (`govt|commercial|nonprofit`, `:18`) or `StatutoryPack`. `profileCode` propagation is WIRED (tenant-service `0035`, events/consumer/onboard) but **no finance consumer materialises it** (grep `tenant.created` in finance = nothing).
2. **A second PSU taxonomy exists in admin-service, UNWIRED.** `admin 0025:113-117` org_profile `psu` carries `rule_packs {pay:ida_cda, leave:psu, appraisal:pms_prp, separation:epf_gratuity_superann}`, terminology "Basic + IDA + perks (CTC)"; `0026:108-117` adds `{accounting_basis:commercial_accrual, procurement_rulebook:psu_manual, revenue_type:sales_service, audit_profile:cag_dpe}` + a PSU module set. **All labels only** — grep for `ida_cda`/`pms_prp`/`cag_dpe`/`commercial_accrual` across services/packages/web finds no consumer.
3. **IDA pay: no trace.** DA exists but **govt-CPC-only** — `payroll.dearness_allowance_rates` (single series per tenant, seeded 50% "7th CPC", `0006`), resolved by `resolveDaRateBps` (`payroll consumer.ts:134-160`). No IDA/CDA distinction, no AICPI index basis, no quarterly cadence, no E-grade/scale ladder. Pay model is `cpc7|private_bands` (`policy-settings/registry.ts:67-73`; `private_bands` came from the Section 8 CTC work). **PSU-only gap.**
4. **EPF + gratuity are WIRED and reusable.** `PensionScheme=GPF|NPS|EPF|UPS|NONE` (`payroll/domain.ts:50`); EPF end-to-end in `computeSlip` (`domain.ts:719-727`, `pfWageBasis:'actual'` lifts the cap) with `statutory_config`; gratuity PoG-Act rule engine (`gratuity-rules/rules.ts` `pog_act`, "PSU/small office/private", 15/26, ₹20L ceiling) wired via `integration/consumer.ts:214`. **But:** no profile-driven default (only per-employee `employeeType='psu'` → EPF via `employee/pension-scheme.ts:28,41-47`; PSU permanent staff otherwise default NPS). **Three unreconciled gratuity paths** (payroll rule engine; hrms `fnf-route.ts` hard-coded 15/26; hrms separation CCS DCRG). CPF module is govt-style, not PSU EPF. Superannuation / exempted-trust PF: no trace.
5. **DPE / PRP / perks / board: no trace.** Only unread labels (`pms_prp`, "Basic + IDA + perks"). No perks-ceiling (50% of basic), no PRP/MOU scoring, no Board/CMD/functional-director post model, no sitting fees. Bonus Act exists (different regime). **Largest PSU-only build, nothing to reuse.**
6. **CAG/audit: govt inspection-para tracking exists; PSU statutory audit absent.** audit-service + finance `audit-paras` model CAG inspection-report paragraphs / PAC follow-up (`audit-service observation/queries.ts:6`, `finance audit/routes.ts:57`). **Absent:** supplementary audit u/s 143(6), CAG-appointed statutory auditor workflow, CARO 2020, audit committee as a structure, comments-on-accounts / C&AG certificate. `audit_profile='cag_dpe'` is an unread label. **PSU-only.**
7. **Commercial books OVERLAP MSME.** No `psu` coa_template → PSU reuses `commercial`. No commercial seed on main; `accounting_basis` changes no posting; the AP bill path is hard-wired to HoA + DDO (`payments/consumer.ts:176,178`) — the same blocker the MSME design fixes (`assertBillHeadValid`). Group structure partially wired (`org.legal_entities` "≈ subsidiary company", cost/profit centres; `gl/consumer.ts:143-165`). **Public-sector heads absent:** government equity/grants, capital reserve, dividend payable to Govt, DIPAM.
8. **Schedule III / CARO / Ind AS OVERLAP MSME.** Statements exist but are govt-COA-driven by **leading-digit classification** (`head-nature.ts` — the same prefix-heuristic the MSME panel flagged; classification must be stored). No Schedule III Division structure, no Notes, no CARO, no Ind AS, no SOCE, no indirect cash flow. PSU adds Ind AS + CARO **on top of** the MSME Schedule III work.
9. **Government shareholding / dividend / DIPAM: no trace.** No share-capital/paid-up/government-equity/dividend-to-Govt/DIPAM model. **PSU-only.**
10. **No existing PSU design doc** (only Section 8's). PSU is a deferred follow-on in the tenant-profile doc §8.
11. **No live `edition=psu` tenant** — only a single `psu` *composition-profile* row (6 Nov snapshot; not necessarily an edition-psu tenant). **PSU has no pilot** (unlike DIC for Section 8, or the 12 MSME tenants).

---

## 0.5 The gating decision: is PSU worth building now? (owner question #1)

PSU is **the largest PSU-only build of the three segments** (DPE + IDA + CAG + shareholding, items 1/3/5/6/9 above — nothing to reuse) **and has no live pilot tenant to validate against**. The other two segments have real tenants (DIC; 12 MSME). So the honest recommendation:

- **If no PSU customer is in sight:** keep PSU **design-only** (this doc), build nothing, and revisit when a real PSU is onboarded. The ~45–60 PSU-only dev-days shouldn't be spent speculatively.
- **If a PSU customer is identified:** sequence it *after* MSME ships (because PSU reuses MSME's commercial COA + Schedule III + accrual + Section 8's EPF/gratuity/CTC), then build only the PSU-only overlay. v1 would be: profile activation + commercial reuse + IDA pay + government shareholding/dividend + CAG/CARO statements; DPE PRP/MOU and board-post modelling as v2.

Everything below assumes the "customer identified" path and is scoped as a thin overlay on MSME + Section 8.

---

## 1. Relationship to the other designs — PSU reuses, doesn't rebuild

| PSU needs | Source (reuse) | PSU adds |
|---|---|---|
| Commercial COA (`budget.finance_heads` + `statement_class`), HoA/DDO skip, accrual posting | **MSME M1/M3** (PR #2549) | public-sector heads: govt equity, capital reserve, dividend-payable-to-Govt (P4) |
| Schedule III statements (entity-type-driven, classification stored) | **MSME M8** | Ind AS + CARO + SOCE + indirect cash flow (P3) |
| Profile activation, settings-column gating, `TENANT_PROFILES_ENABLED` | **tenant-profile S0–S5** | `psu` profile def (accrual/commercial/`psu_in` statutory), `pay_scheme`/`audit_profile`/`govt_owned` settings (P6) |
| EPF, gratuity (PoG Act), pay-matrix, CTC engine, `statutory_config` | **Section 8 HR** (`section8-design.md`) + payroll as-is | profile-driven EPF default, superannuation/trust PF, gratuity-path consolidation (P5) |

So PSU's net-new is **P1 IDA pay, P2 DPE, P3 CAG/CARO/Ind AS statement add-ons, P4 govt shareholding/dividend, P5 retirals alignment, P6 profile activation** — with P3/the COA base leaning on MSME.

---

## 2. Gap P1 — IDA pay scales (PSU-only)
A scheme selector `pay_scheme ∈ (cda|ida)` (default `cda`; a settings column, not edition-forked). For `ida`: an **IDA rate series** with its index basis (AICPI-IW linked, quarterly revision per DPE — **VERIFY** the formula and quarters) — model as a `scheme` column on `dearness_allowance_rates` (additive) or a parallel `ida_rates` table; a **PSU pay-scale / E-grade ladder** (E0–E9 / W-grades, scale ranges — **VERIFY** the current DPE pay revision, 2017 scales), added as a new `pay_scale.kind='ida_scale'` alongside `cpc7|private_bands`; HRA/CCA/perk linkage to IDA. Quarterly-revision workflow (maker-checker, effective-dated, like the DA table's). **Effort:** ~6–8 d. **Dependency:** reuses the payroll pay-matrix + `statutory_config` seams.

## 3. Gap P2 — DPE compliance (PSU-only; largest, nothing to reuse)
DPE pay-guideline engine: **perks ceiling (50% of basic pay — VERIFY)** enforced on the CTC/perk set (reuse the Section 8 CTC engine's component model, add a cap rule); **PRP** (Performance Related Pay) tied to **MOU rating** + profit (bands/ceilings per DPE — VERIFY); a **Board / CMD / functional-director / part-time-director post model** with sitting fees; cafeteria/perk-basket. **Effort:** ~8–10 d. Flag `dpe_compliance`. **Risk:** DPE guidelines change by Office Memorandum — all figures effective-dated config with a named reviewer. **v2 candidate** (defer PRP/MOU/board if the pilot doesn't need them day one).

## 4. Gap P3 — CAG statutory audit + CARO + Ind AS (PSU-only add-ons over MSME M8)
On top of the MSME Schedule III base: **supplementary audit u/s 143(6)** workflow (statutory auditor → CAG supplementary → comments-on-accounts / "nil comments"); **CAG-appointed statutory auditor** appointment tracking (distinct from the existing govt CAG-*para* tracking, which stays); **CARO 2020** clause checklist; **audit committee** as a structure (not just a step label); **Ind AS** presentation (115/116/109, SOCE, indirect-method cash flow) selected by a settings threshold (listed/large PSU — **VERIFY**). Reuse the audit-service + finance audit-para modules for the para/compliance plumbing; add the PSU statutory-audit entities. **Effort:** ~6–8 d. **Dependency:** MSME M8 (Schedule III base) + the stored-classification fix.

## 5. Gap P4 — Government shareholding, dividend, DIPAM (PSU-only)
Public-sector heads on the commercial COA (reusing MSME's `seedGlHeadsTx` content mechanism, in `budget.finance_heads` with `statement_class`): government equity / paid-up capital, capital reserve, grants-in-aid-for-capital, **dividend payable to Government**. A shareholding/paid-up model (govt %, DIPAM payout policy — min dividend per DIPAM guidelines, **VERIFY**), dividend declaration → payable → remittance flow (maker-checker, audited). **Effort:** ~4–5 d. **Dependency:** MSME M1 (commercial COA) + the fund/settings seams.

## 6. Gap P5 — Retirals alignment (partly reuse)
Reuse EPF/gratuity. Add: **profile-driven default EPF** for all PSU staff (not just `employeeType='psu'`) resolved from settings (`statutoryPack='psu_in'`), never NPS by default; **superannuation / NPS-corporate** (employer ~10% of basic, perk-linked — VERIFY) and **EPF-exempted trust PF** (company PF trust) as scheme options; **consolidate the three gratuity paths** (payroll rule engine as the single source; retire hrms `fnf-route.ts` 15/26 hard-code and the CCS-DCRG use in hrms separation for commercial/PSU tenants — route by settings). **Effort:** ~4–5 d (incl. the consolidation, which also de-risks Section 8/MSME). **Risk:** touches shared payroll — golden-pin govt F&F first.

## 7. Gap P6 — `psu` profile activation + settings
Replace the `legacyPlaceholder` with a real `psu` profile: `family:commercial`, `accrual`, `advisory` (or mandatory per DPE budget discipline — owner decision), `coaTemplate:'commercial'`, `statutoryPack:'psu_in'` (new), `active:true` (behind the flag). Add settings columns `pay_scheme`, `audit_profile`, `govt_owned`/`shareholding_pct` on `gl.finance_settings` (M0-style migration, maker-checker, not API-settable). **Wire or drop** the admin-service composition `rule_packs` labels (don't leave dead labels). Wizard captures CIN, govt shareholding, DPE schedule (A/B/C/D), IDA scale set, CAG auditor. **Effort:** ~3 d. **Dependency:** tenant-profile S0–S5; MSME M0 settings pattern.

---

## 8. Backward compatibility, flags & fail-safe
Same as MSME §10: flags default off; existing tenants (`govt`, and the Section 8 / MSME tenants) byte-identical with PSU flags off AND on; fail-closed by classification; `coa_template`/`pay_scheme` switch refused if ledger/payroll history exists; lint test bans `edition`/`'psu'` literals in posting/pay modules; `schema.sql ⇄ models ⇄ Alembic` in sync. The gratuity-path consolidation (P5) is the one change touching shared payroll — gated by settings, govt F&F golden-pinned.

## 9. Implementation plan & estimate (assumes the "customer identified" path)

| # | Slice | Depends | Effort |
|---|---|---|---|
| P6 | `psu` profile activation + settings columns (`pay_scheme`/`audit_profile`/`govt_owned`) + wire/drop rule_packs | tenant-profile S0–S5, MSME M0 | 3 d |
| (reuse) | Commercial COA + accrual + HoA/DDO skip + Schedule III base | **MSME M1/M3/M8** — not rebuilt | 0 (reuse) |
| P4 | Government equity/dividend/DIPAM heads + dividend flow | MSME M1, P6 | 4–5 d |
| P1 | IDA pay scale/E-grade ladder + quarterly revision | payroll pay-matrix, P6 | 6–8 d |
| P5 | Profile-driven EPF default + superannuation/trust PF + gratuity-path consolidation | payroll, P6 | 4–5 d |
| P3 | CAG 143(6) supplementary audit + CAG auditor + CARO 2020 + Ind AS + SOCE | MSME M8, P6 | 6–8 d |
| P2 | DPE perks-cap + PRP/MOU + Board/CMD post model (v2 candidate) | Section 8 CTC, P1 | 8–10 d |

**PSU-only net-new: ~31–39 dev-days; ~45–55 calendar incl. review loops and the pilot dry-run — ON TOP OF MSME shipping first.** Critical path P6 → P4/P1/P5 → P3; P2 (DPE) is the biggest and the most deferrable. Build only after sign-off, after MSME, and **only if a PSU customer is identified** (§0.5).

## 10. What to reuse (the point of this design)
MSME #2549: commercial COA (`budget.finance_heads`+`statement_class`), `assertBillHeadValid` HoA/DDO skip, accrual posting, Schedule III statements (classification stored), `gst_registered`/settings-column pattern, the new `ar`/invoice tables if the PSU sells. Section 8 HR: the CTC component engine (for perks/DPE cap), pay-matrix, EPF/gratuity, `statutory_config`. tenant-profile S0–S5. audit-service + finance audit-para plumbing (for P3). Group structure (`org.legal_entities`, cost/profit centres) for subsidiary/segment reporting. Don't rebuild any of these.

## 11. Open questions for the owner (ordered)
1. **Is there a real PSU customer, or is this speculative?** (§0.5) If none, keep PSU design-only and build nothing now — it's the largest PSU-only build with no pilot.
2. **If building:** confirm PSU after MSME (reuse chain), and the pilot PSU's profile: listed vs unlisted (Ind AS threshold), DPE schedule (A/B/C/D), IDA scale set, govt shareholding %, budget discipline (advisory vs mandatory).
3. **Scope:** DPE PRP/MOU/board modelling in v1 or v2? (Recommend v2 unless the pilot needs it.)
4. **Gratuity consolidation (P5)** touches shared payroll — approve consolidating the three paths behind settings (benefits Section 8/MSME too)?
5. **Statutory figures (VERIFY), named company secretary / CA:** DPE pay-scale set + perks 50% cap + PRP/MOU bands; IDA/AICPI quarterly formula; CARO 2020 clauses; Ind AS applicability threshold; DIPAM minimum-dividend policy; superannuation/trust-PF rules.

## 12. Cross-cutting risks
1. **No pilot** — the biggest risk is building speculatively (§0.5, owner Q1). PSU-only pieces have nothing to validate against until a real PSU onboards.
2. Statutory correctness (DPE + Companies Act + Ind AS) is the gating risk; config + effective dates + a named company-secretary/CA; nothing here is law.
3. P5 touches shared payroll (gratuity) — govt F&F golden-pinned first, byte-identical, flags off and on.
4. Reuse-chain scheduling: PSU depends on MSME (commercial COA + Schedule III) and Section 8 HR shipping first; starting PSU build before those land is a schedule risk.
5. Migration-number + flag-default coordination across #2468, Section 8, MSME and PSU; per-service numbering doesn't cross-collide; re-check at build.
6. Scope: live CAG/MCA/DIPAM filing *integrations* are out of v1 — exports only.

## 13. Reviewer panel disposition
To be completed after the 3-lens review (domain/compliance, data-model, architecture/isolation), as for Section 8 (#2547) and MSME (#2549).
