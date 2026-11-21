# PSU (public sector undertaking) segment: paper design

**Status:** DESIGN for review — **revision 2**, after a 3-lens reviewer panel (domain/compliance, data-model, architecture/isolation; all APPROVE-WITH-CHANGES). No code. Third in the roadmap (Section 8 → MSME → **PSU**). **Mostly reuse** of the MSME commercial design (#2549) and the Section 8 HR work, plus a PSU-only government-ownership overlay. Panel dispositions in §14.

**Source:** repo `~/CivitasOne/civitasone-suite` at `origin/main` (`730f7558d`), read-only; as-is map + reviewer panel, 15–16 Nov 2026. Line numbers drift — re-grep before coding.

**Constraint:** OFF the UAT server until the 18–20 Nov sign-off; flags default **false**. **And a prior gate:** there is **no live PSU tenant** — §0.5 recommends keeping this design-only until a real PSU customer is identified. Everything below is the plan *if* that gate opens.

**VERIFY** marks a statutory/legal figure not confirmed from an authoritative source (panel WebSearch returned only secondary/garbled sources). Every figure is effective-dated config with a named company-secretary/CA reviewer. No sentence states current law.

**Migrations:** this repo uses per-service SQL migrations (not the Python platform's `schema.sql⇄models⇄Alembic` rule — that belongs to a different project). Reserve migration numbers **at merge**, and PSU's finance migrations must come **after** MSME's.

---

## Cross-cutting contract: configurable rules & tenant isolation
Owner standing rule: *reviewers always; no violation of other tenant types; configurable rules.* As Section 8 / MSME; PSU-specific points:
1. **Data-keyed, per employee-group where workforce is mixed.** A CPSE runs IDA executives/non-executives, CDA deputationists, and workmen under wage agreements **in one tenant** — so pay-scheme selection is **per employee-group / pay-scale-kind with a tenant default**, never a single tenant-level `edition='psu'` branch. Finance behaviour keyed to settings (`coa_template`, `accounting_basis`, `audit_profile`, `govt_owned`).
2. **Flags default off; additive-only; proven isolation; fail-closed by classification; reviewer panel review-until-clean** — as the MSME design. Golden tests prove govt / Section 8 / MSME byte-identical with PSU flags off AND on, and the PSU golden suite **runs the MSME + Section 8 goldens too**.
3. **Lint test** bans `edition`/`'psu'` literals **only in posting/pay paths** (`payroll/*`, `gl/*`, `payments/*`), with a named allowlist for the legitimate existing branches (`hrms recruitment/edition-policy.ts:43`, `tenant-profile index.ts:97` govt_dept mapping, gateway `screen-manifest.ts:144`, and the `profile_code='psu'`/`PROFILES` catalogue entries).

---

## 0. Findings (as-is, panel-verified)
1. **`psu` profile is an inactive govt placeholder** (`packages/tenant-profile/src/index.ts:76` `legacyPlaceholder`); `effectiveSettings()` returns `LEGACY_SETTINGS` (cash/govt) for any inactive profile. No `psu` in `COA_TEMPLATES`. `profileCode` propagated but **no finance consumer materialises it** — so activation writes nothing to settings; settings rows are written only at onboard/seed (good for isolation).
2. **A second PSU taxonomy in admin-service is label-only but not dead** — `rule_packs` (`ida_cda`, `pms_prp`, `cag_dpe`, `commercial_accrual`, `psu_manual`) are persisted (`composition/schema.ts:40`), API-returned (`routes.ts:98,136`) and test-asserted (`composition.test.ts`), with **no business consumer**. → **drop** the PSU labels (forward migration) and replace with real settings keys (§6); don't leave them.
3. **IDA pay: no trace.** DA is govt-CPC-only: `payroll.dearness_allowance_rates` (per-tenant, `UNIQUE(tenant_id, effective_from)`, seeded 50% "7th CPC"), read by `resolveDaRateBps` (`payroll/consumer.ts:134`) + retro loader (`:614`) + `loadDaRates`/`lockDaRates` + gratuity DA (`integration/consumer.ts:185`). Pay model `cpc7|private_bands`. **PSU-only.**
4. **EPF + gratuity wired, reusable; three unreconciled gratuity paths** — payroll rule engine (`gratuity-rules/rules.ts`, `pog_act|ccs_dcrg`, default `pog_act`, via `integration/consumer.ts:214`); hrms `fnf-route.ts` (hard-coded 15/26, no ceiling); hrms separation (`employee/consumer.ts:380`, unconditional CCS DCRG). **A govt tenant today gets path-2 (15/26 uncapped) in F&F *and* path-3 at separation** — so "consolidation" is a behaviour change for govt, not a pure refactor (§5).
5. **DPE / PRP / perks / board: no trace** (only unread labels). PSU-only, largest build.
6. **CAG: govt inspection-para tracking exists; PSU statutory audit absent** (no s.139(5) auditor appointment, s.143(5) directions, s.143(6) supplementary audit/comments, CARO 2020, audit committee structure). PSU-only.
7. **Commercial books OVERLAP MSME** — reuse `commercial` COA, `assertBillHeadValid` HoA/DDO skip, accrual. Public-sector heads absent.
8. **Schedule III / CARO / Ind AS OVERLAP MSME** — statements are leading-digit-classified (classification must be **stored**, per the MSME fix); no Schedule III/CARO/Ind AS. **`statement_class` does not exist on main** — it's an unmerged MSME M1 proposal.
9. **Government shareholding / dividend / DIPAM: no trace.** PSU-only.
10. **No existing PSU design doc; no live `edition=psu` tenant** (one `psu` composition-profile row only).

---

## 0.5 Gate: build now, or design-only? (owner question #1)
Endorsed by the panel: **no live PSU tenant**, PSU-only build is the largest of the three segments, and every figure is subject to DPE Office-Memorandum change. **Recommendation: keep PSU design-only until a concrete trigger** — a signed LOI or a named pilot CPSE. Then build only the overlay, **after** MSME and Section 8 HR ship (the reuse chain). Building speculatively risks encoding a wrong DPE/pay-revision regime. All slices below assume the gate has opened.

---

## 1. Reuse map (PSU reuses, doesn't rebuild)
| PSU needs | Reuse from | PSU adds |
|---|---|---|
| Commercial COA, HoA/DDO skip, accrual | MSME M1/M3 | public-sector heads via P4 |
| Schedule III statements (classification **stored**) | MSME M8 | Ind AS + CARO + SOCE (P3) |
| `statement_class` column + enum | **MSME M1 (hard-gate; extend its enum for equity/reserve/dividend-payable NOW)** | — |
| Profile activation, settings pattern (0166) | tenant-profile S0–S5 | `psu` profile + settings (P6) |
| EPF, gratuity engine, pay-matrix, CTC, `statutory_config` | Section 8 HR + payroll | per-group IDA, gratuity-path gate (P1/P5) |
| hrms grade bands (`hrms_grade_bands` 0270, E-grades) | Section 8 `private_bands` | — (reuse, don't add `ida_scale`) |

---

## 2. Gap P1 — IDA pay (PSU-only)
**Separate `ida_rates` table** (not a `scheme` column on `dearness_allowance_rates` — that would force an unsafe unique-key change and break every `ON CONFLICT`/reader; reviewer B1). `ida_rates(tenant_id, employee_group, effective_from, rate_bps, index_basis, aicpi_points, quarter, order_ref)`, FORCE RLS, tenant-scoped. A new **`resolveIdaRateBps(group)`** selected by the employee-group's pay scheme; `resolveDaRateBps` stays **byte-identical** (a missed reader must never mix CDA/IDA — the retro loader `:614` is the likeliest to miss). Reuse `private_bands` + `hrms_grade_bands` (E0–E9) for the scale ladder — **do not add `pay_scale.kind='ida_scale'`** (fallthrough consumers would treat it as cpc7 and hit the level-1-18 rule). Add AICPI-IW source + publication-lag, quarterly revision, versioned scale sets per pay-revision cycle (2007/2017/next), DA merger/neutralisation, pay fixation/fitment/arrears. `pay_scheme` (cda|ida) is **owned by payroll** (its `statutory_config`), not a finance column read cross-service; it must agree with `pay_scale.kind` via a single documented source of truth, fail-closed on mismatch. **Effort:** ~8–10 d.

## 3. Gap P2 — DPE compliance (PSU-only; largest; v2)
**Perks ceiling as an effective-dated per-pay-revision-cycle parameter** (50% 2007 / 35% 2017 cafeteria — VERIFY per cycle), with the allowances that sit *outside* the ceiling, and executive/non-executive + **Schedule A/B/C/D as a first-class setting** (drives scale ceilings + Board pay). **PRP** = pool set by profit, individual payout by grade × MOU rating (DPE OM — VERIFY). **MOU** modelled as its *own* annual process (targets + rating), not hung on PRP. **Board posts** modelled separately: nominee (govt employee, no CPSE fee) vs part-time-official vs independent (sitting fees, Companies Act caps) vs functional director; Board-level pay fixed by the administrative ministry. Reuse the Section 8 CTC component model for the perk basket + cap. **Effort:** ~10–14 d. **v2.**

## 4. Gap P3 — CAG statutory audit + CARO + Ind AS (PSU-only, over MSME M8)
**Split into three flows with their own entities (not the govt para tables, which stay):** (a) **s.139(5)** CAG-appointed statutory auditor appointment/panel; (b) **s.143(5)** CAG directions to the auditor + the audit report + **CARO 2020** checklist + **audit committee** structure; (c) **s.143(6)** CAG supplementary audit + comments-on-accounts + board reply. **Ind AS** as a **sticky one-way threshold flag** (listed, or unlisted net worth ≥ ₹250cr, + holding/subsidiary/JV/associate coverage — VERIFY; not auto-reversed if net worth falls), adding Ind AS 115/116/109 **plus 19 (employee-benefit actuarial, gratuity/leave) and 24 (related-party / government-related-entity disclosures)**, SOCE and indirect-method cash flow. **Effort:** ~8–11 d.

## 5. Gap P4 — Government shareholding, dividend, DIPAM (PSU-only)
Public-sector heads into **per-tenant `budget.finance_heads`** with the MSME `statement_class` (never the global `finance_major_heads` — add a test asserting this): government equity / paid-up capital, capital reserve, grants-in-aid-for-capital, **dividend payable to Government**. A **cap table** `shareholders(tenant_id, holder, class, shares, face_value)` — not a single `shareholding_pct` column — to compute dividend per holder (President of India + public). DIPAM minimum dividend (higher of 30% PAT / 5% net worth — VERIFY), interim vs final, **TDS on dividend**, declare→payable→remit flow; bonus/buyback/split events. **New tables** (declaration/payable/remittance) with FORCE RLS + `tenant_isolation` policy + indexes + audit, specified explicitly. **Effort:** ~5–6 d.

## 6. Gap P5 — Retirals alignment + gratuity-path gate (partly reuse; shared-payroll risk)
**Additive, never retiring the legacy paths in this slice.** Add a new `resolveSeparationGratuityPath(settings)` selecting `{legacy_ccs_hrms, legacy_fnf_15_26, payroll_rule}`, gated on a stored setting (a `gratuity_rule_config` row / `coa_template != 'govt'`), **default = the legacy path for every existing tenant** so govt F&F stays byte-identical. The real PSU bug it fixes: the hrms separation consumer computes CCS DCRG while payroll pays PoG — only a profile-activated PSU/commercial tenant gets the unified `payroll_rule`. Fix the hrms 15/26 **number→bigint** arithmetic only on the new route. **This de-risks only the PSU mismatch** — Section 8 / MSME have the same mismatch and need their own gate + goldens (do not claim their benefit here). **Golden pins first:** govt F&F (path-2 as-is incl. missing ceiling), separation DCRG per type incl. the 2024-01-01 ceiling boundary, both engine rule sets at ceiling + 5-year boundary, retro/DA-gap, and a PSU `pog_act` old-vs-new parity test listing the diffs. Plus profile-driven **EPF default** (hire-time only, existing employees never re-defaulted), **superannuation / exempted-trust PF / post-retirement medical**, **leave encashment + DPE cap**, and deputationists keep **CCS** (the mixed-workforce link). **Effort:** ~5–7 d. **Consider doing the gratuity consolidation in the Section 8 stream** rather than inside PSU.

## 7. Gap P6 — `psu` profile activation + settings
Replace the `legacyPlaceholder` with a real `psu` profile (`family:commercial`, `accrual`, budget discipline per DPE — owner decision, `coaTemplate:'commercial'`, `statutoryPack:'psu_in'`). **Activation is per-tenant** (the settings row sets active), **never a global flip of the catalogue definition** (that would change the existing `psu`-profile tenant's basis/COA on deploy). Settings (cite the **0166** pattern, one migration per owning service): `audit_profile` (**single source of truth** — drop the admin `rule_packs.audit_profile`), `govt_owned boolean DEFAULT false`, `shareholding` via the P4 cap table; `pay_scheme` lives in **payroll** (§2). **Pre-flight:** `SELECT count(*) WHERE profile_code='psu' OR edition='psu'` must be 0, or record each tenant's ledger/payroll state. An explicit **maker-checker "re-seed profile"** action, refused if any ledger **or payroll/F&F/gratuity** history exists. **Effort:** ~3 d.

---

## 8. Backward compatibility, flags & fail-safe
Flags default off; existing govt/Section 8/MSME tenants byte-identical with PSU flags off AND on (goldens include theirs); fail-closed by `statement_class`; switch refused if ledger **or payroll** history exists; per-tenant activation; lint scoped to posting/pay with the named allowlist.

## 9. Implementation plan & estimate (redone)
| # | Slice | Depends | Effort |
|---|---|---|---|
| P6 | `psu` profile activation (per-tenant) + settings + drop/replace rule_packs + pre-flight | tenant-profile S0–S5, MSME M0 | 3 d |
| (reuse) | commercial COA + accrual + HoA/DDO skip + Schedule III base + `statement_class` (enum extended for PSU values) | **MSME M1/M3/M8 — hard gate** | 0 |
| P4 | Govt equity/dividend/DIPAM heads + cap table + dividend flow (new tables) | MSME M1, P6 | 5–6 d |
| P1 | `ida_rates` table + `resolveIdaRateBps` (per-group) + versioned scales (reuse grade-bands) | payroll, P6 | 8–10 d |
| P5 | Gratuity-path gate (additive) + EPF default + superannuation/trust PF + leave encashment | payroll, P6 | 5–7 d |
| P3 | Split CAG (139(5)/143(5)/143(6)) + CARO + Ind AS (sticky flag, +AS 19/24) | MSME M8, P6 | 8–11 d |
| P2 | DPE perks-cap (per-cycle) + PRP/MOU + Board posts (v2) | Section 8 CTC, P1 | 10–14 d |

**PSU-only net-new: ~40–55 dev-days (floor, +25–40% over r1 per the panel); ~60–80 calendar incl. review loops + the pilot dry-run — ON TOP OF MSME + Section 8 shipping first, and only if the §0.5 gate opens.** Critical path P6 → P4/P1/P5 → P3; P2 is the largest and most deferrable.

## 10. What to reuse
MSME #2549: commercial COA (`budget.finance_heads` + `statement_class`), `assertBillHeadValid`, accrual, Schedule III (classification stored), the 0166 settings-column pattern. Section 8 HR: CTC component engine (perks/DPE cap), pay-matrix, `hrms_grade_bands` (E-grades), EPF/gratuity engine, `statutory_config`. tenant-profile S0–S5. audit-service + finance audit-para plumbing (P3 para/compliance). `org.legal_entities`/cost-profit-centres (subsidiary/segment reporting). Don't rebuild these.

## 11. Open questions for the owner (ordered)
1. **Is there a real PSU customer (signed LOI / named pilot)?** If not, keep design-only, build nothing (§0.5).
2. **If building:** confirm after MSME + Section 8; pilot PSU's listing/net-worth (Ind AS), DPE Schedule (A/B/C/D), pay-revision cycle (2007/2017), govt shareholding, budget discipline (advisory/mandatory).
3. **Mixed workforce:** confirm the pilot has IDA + CDA-deputation + workmen groups (sets the per-group pay model).
4. **Gratuity consolidation (P5):** do it in the Section 8 stream (benefits all commercial tenants) or inside PSU? Approve the additive-with-legacy-default gate.
5. **Statutory figures (VERIFY), named company secretary/CA:** DPE pay scales + per-cycle perks cap + PRP/MOU; IDA/AICPI quarterly formula; CARO 2020; Ind AS threshold + AS 19/24; DIPAM dividend policy; s.139(5)/143(5)/143(6) wording; superannuation/trust-PF/leave-encashment caps.

## 12. Cross-cutting risks
1. **No pilot** — speculative build risk (§0.5).
2. Statutory correctness (DPE + Companies Act + Ind AS) is the gating risk; config + effective dates + named CS/CA.
3. **P5 touches shared payroll** — additive, legacy-default, govt F&F golden-pinned; **not** byte-identical for the hrms path-2 F&F number once a tenant opts into the engine (a gated bug fix, not silent).
4. Reuse-chain build order: PSU finance migrations after MSME's; PSU `statement_class` values extend MSME's enum + fail-closed (never the leading-digit heuristic); reserve migration numbers at merge.
5. Mixed-workforce: `pay_scheme` is per employee-group, not tenant-level.
6. Scope: live CAG/MCA/DIPAM filing integrations out of v1 — exports only; P2/P3 add PSU-only tables to be specified at build.

## 13. (reserved)

## 14. Reviewer panel disposition (revision 1 → 2)
Three lenses, 15–16 Nov; all APPROVE-WITH-CHANGES.
- **Domain/compliance:** perks ceiling is per-pay-cycle (50%/35%), not flat; split CAG into s.139(5)/143(5)/143(6); Ind AS sticky flag + AS 19/24; cap table not `shareholding_pct`; **mixed workforce → per-group pay**; estimate +25–40%; endorsed design-only.
- **Data-model:** **no `scheme` column** on the DA table → separate `ida_rates` + per-group resolver, govt resolver byte-identical (B1); `statement_class` is an unmerged MSME M1 dependency, extend its enum for PSU values now (B2); reuse `private_bands`+grade-bands not `ida_scale`; `pay_scheme` owned by payroll not a cross-service finance column; `audit_profile` single source; per-tenant activation + pre-flight; reserve migration numbers at merge; dropped the wrong `schema.sql⇄Alembic` citation.
- **Architecture/isolation:** gratuity consolidation must be additive with a legacy default — govt no-row already gets `pog_act`, so it's not byte-identical for the hrms F&F path and must be per-tenant gated (B1); reword the Section 8/MSME de-risk claim; drop the dead `rule_packs` labels; `resolveIdaRateBps` leaving `resolveDaRateBps` byte-identical; lint allowlist concrete; per-tenant activation not a global catalogue flip; PSU golden suite runs MSME + Section 8 goldens.
