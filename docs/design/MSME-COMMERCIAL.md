# MSME / small-business (commercial) segment: paper design

**Status:** DESIGN for review — **revision 2**, after a 3-lens reviewer panel (domain/compliance, database, architecture/isolation; all APPROVE-WITH-CHANGES). No code. Part of the segment roadmap (Section 8 → **MSME** → PSU). Companion to the tenant-profile switch (`docs/design/TENANT-PROFILE-SWITCH.md`, PR #2467 / merged #2468), whose `commercial` COA template is the other half of slice S4. Panel dispositions in §15.

**Source:** repo `~/CivitasOne/civitasone-suite` at `origin/main` (`730f7558d`), read-only; an as-is map + reviewer panel, 15 Nov 2026. Line numbers drift — re-grep before coding.

**Constraint:** parallel work, OFF the UAT server until the 18–20 Nov sign-off. Flags default **false**; a merge after sign-off changes nothing until a flag is turned on per tenant.

**VERIFY** marks a statutory/legal figure or rule not confirmed from an authoritative source (panel WebSearch returned only commercial blogs, no CBIC/GSTN primary source). Every threshold is effective-dated config with a named CA/counsel reviewer, engaged **before M2**. No sentence states current law.

---

## Cross-cutting contract (read first): configurable rules & tenant isolation

Owner standing rule: *reviewers always; no violation of other tenant types; configurable rules.* (Shared governance memo; identical to the Section 8 design.)

1. **Data-keyed, never edition-forked.** No business-logic branch reads `edition`/`profileCode`/`family`. Commercial behaviour is gated by **stored settings on `gl.finance_settings`**: `coa_template` (`commercial`), `accounting_basis` (`accrual`), and new `gst_registered`/`gstin`/`gst_effective_from` + `entity_type` — resolved via `loadSettingsTx` once per posting (the precedent: `gl/consumer.ts` already reads `accountingBasis` at :475/:551/:649/:699/:988). The profile catalogue only *seeds* these at onboard; `tenant-onboard/consumer.ts` is the one allowed `edition→settings` mapping point. **Lint test (widened):** CI fails if any file in `finance-service/src` *outside* `approvals/` and `tenant-onboard/` imports `tenant-profile`/`getProfile`/`PROFILES`, reads `edition`, references `process.env.*EDITION*`, or contains the literal `'small_office'`/`'section8'`. (The original transitive-only lint was too weak — reviewer S1.)
2. **Flags default off.** `TENANT_PROFILES_ENABLED` (global activation) + per-tenant settings. `coa_template != 'govt'` gates commercial heads/statements/sales-invoicing; `gst_registered` gates GST lines. With them off/govt, every tenant runs today's path.
3. **Additive-only, lock-safe.** New tables; new nullable columns (metadata-only `ADD COLUMN`); FKs `NOT VALID`→`VALIDATE` under `SET lock_timeout`; indexes `CREATE INDEX CONCURRENTLY` (which **cannot run in a transaction** — big-table indexes go in their own non-transactional migration file; the runner uses plain `CREATE INDEX IF NOT EXISTS` today, so confirm/segregate), **partial** where they serve only commercial rows; heads seeded `ON CONFLICT (tenant_id, code) DO NOTHING` **with a collision guard** (abort if an existing head under the same code has a different `classification`/purpose — a govt tenant already using 2300/3000/2202 would otherwise be silently skipped). No row rewrite, no head rename/move, no govt-reachable function changes signature/default (commercial logic is **new** functions selected by settings — e.g. `assertBillHeadValid(settings, head)` delegates unchanged to the existing assertions for govt).
4. **Proven isolation.** Golden tests compare full ledger rows, trial balance, statements and year-end JSON for a seeded **govt** tenant, before/after migration, flags off AND on — byte-identical; **plus** the existing billing AR path (`source='billing_event'`) byte-identical. A **permanent cross-tenant CI regression**: a govt tenant is RLS-denied on every new table (customer, invoice, …) and has **zero `gl.finance_gst_ledger` rows** after bills (flags on and off). Commercial routes are gated by a **centralised Fastify preHandler** reading settings (404/403 when `coa_template='govt'`), not per-handler.
5. **Fail-closed by classification, not code.** `coa_template='commercial'` but the required commercial heads (checked by `classification`/purpose, not mere code existence) absent ⇒ refuse to post. Name the required-code set in M1.
6. **Reviewer panel, review-until-clean** on the design and every slice. The CA reviewer is engaged **before M2** (statutory correctness is the gating risk).

---

## 0. Findings that shape the brief (as-is, re-verified by the panel)

1. **No tenant-side SALES invoicing or customer master exists — the core MSME flow is absent.** No customer master server-side (GSTIN only in the mobile form), no sales invoice with GST, no credit/debit notes. The only sales-invoice posting path is the dead `finance/simplified/` (§0.4). Mobile has an invoice screen that **dead-letters** (no sync route). **Correction (reviewer B2): an AR sub-ledger *does* exist** — `gl.finance_ar_ledger` (`0009:97`, debtor_id/demand_id/aging_bucket/RLS+FORCE), fed by the **platform-billing** consumer, extended by 0167. So M2 must decide how tenant-sales AR relates to it (§3).
2. **GST primitives scattered across 5 services, disconnected from the books.** Platform SaaS GST invoicing (`billing invoices/`); GSTN return filing UI+adapter (`billing gstn/`, env-gated, **aggregate-only**, totals *platform SaaS* invoices); e-Invoice/IRN (`billing einvoice`, **mock**, hard-coded buyer/HSN/rate); e-Way bill (`stock eway-bill`, no web caller); finance GST ledger read API (`finance gst/`) whose **producer is UNWIRED** (`finance.gst.entry_record` has no publisher — confirmed by all three reviewers; `gl.finance_gst_ledger` is empty). **No GST line posted on any path.** No GST rate master (hard-coded slab list in `gst-rates.ts:42`), no HSN/SAC master, no tenant GSTIN in the books.
3. **`commercial` COA template is spec + column only.** Heads go in **`budget.finance_heads`** (`0001_init:11`, `UNIQUE(tenant_id, code)`) — *not* `gl.finance_heads` (reviewer B1); `budget.finance_major_heads` is global (RLS-skipped, read-only reference). `coa_template` CHECK exists (`0166`) but nothing reads it to choose heads. `standardGlHeads()` is one govt list (default bill head `2202`). The head table's `level`/`classification` (revenue|capital|plan|nonplan) **can't drive Schedule III** — M1 adds a **nullable `statement_class`/`account_type` column**.
4. **`finance/simplified/` is dead-but-registered** (routes `app.ts:134-135`, consumers `worker.ts:50`, flat chart + GST auto-journal, no client; edition guard trusts an `x-tenant-edition` header nothing but tests set). It is a **header-trust security surface** — retiring it is a cleanup, arguably not v2. Harvest only its **chart content as data** (not its `auto-journal.ts`, which bypasses the GL tx/`markProcessed`).
5. **`small_office` profile `active:false`; its tenants behave as govt today** (govt chart, DDO, cash basis). `msme-onboard` captures `udyam/category/sector/gstin` into `settings.msme` (read by almost nothing; **don't rely on it in finance** — different service/store, unvalidated). **12** live `small_office` tenants (not ~18); re-derive at build.
6. **Sector module sets + screen manifest are data without wiring** (`resolveMsmeModules` uncalled; `/config/screens` unconsumed). **Hazard:** `screen-manifest.ts:208,222` defaults `edition='small_office'` on any tenant-fetch failure — harmless now, but once M6 wires it, a transient failure shows a govt tenant the MSME shell. Fail-closed before M6.
7. **Accrual partial; HoA is the hard commercial blocker** (two sites: `payments/consumer.ts:177` and `payments/routes.ts:42`, both `assertValidHoAWithMaster`; DDO softened via `DDO000001` default but commercial must not silently pick it up). `accrualStoresHeads()` never seeded at provisioning.
8. **Udyam/sector captured but unused.** No registry verification, no 43B(h)/MSMED tracking, no Form-1, no turnover classification.

---

## 0.5 Pilot tenant, entity type & v1 scope — the gating decisions (owner questions)

MSME has **12 live `small_office` tenants** but no named pilot. Four answers set v1:
1. **Pilot tenant** — which of the 12?
2. **Entity type** (reviewer domain-B1) — **company / LLP / partnership / proprietorship**. Schedule III applies **only to companies**; firms/proprietors use a Trading + P&L + Balance Sheet (ITR-3/4/5, 3CB/3CD tax audit if thresholds crossed); LLPs use Form 8/11. Statement template is selected by a stored `entity_type`.
3. **GST status** — **regular / composition / unregistered / QRMP** (a bare boolean is insufficient; composition dealers issue a *bill of supply*, no tax invoice, file CMP-08/GSTR-4).
4. **Turnover** — if above the e-invoice threshold (~₹5cr VERIFY), **e-invoice (M5) moves into v1** (a tax invoice without IRN/QR is non-compliant); also drives HSN digit count.

**Recommended v1 core:** M0, M1, **M2 (sales invoicing + customer master + AR)**, M3a/M3b (GST in books incl. RCM + per-tax ITC), M4 (GSTR-1/3B prepare from tenant data), M8 (entity-type statements). **v2:** M5 e-invoice/e-way, M6 Udyam/MSMED/sector wiring, M7 retire `simplified/` (or earlier as a security cleanup), GSTR-2B matching, GSTR-9/9C.

---

## 1. Relationship to the tenant-profile switch
- **Hard gate:** **S4** (`seedGlHeadsTx`) must be **merged before M1** can pass tests; S5 (admin `small_office` bundle) + `small_office.active=true` before activation. §10 fail-closed covers the pre-S4 window.
- **Owns:** commercial COA content, sales invoicing + AR + customer master, GST-in-books (producer), GST returns from tenant data, e-invoice/e-way wiring, Udyam/MSMED, entity-type statements, `simplified/` retirement.

---

## 2. Gap M1 — Commercial COA + activation
Build the `commercial` head set (5400 Purchases/default bill head; 1500/1600/1700; 1800 TDS Receivable; 2300 GST Payable/2310/2400/2500; 3000 Share Capital/3200; 4400; 5410-5450; 6200 — per `TENANT-PROFILE-SWITCH.md §2.3`) in **`budget.finance_heads`**, via **S4's** `seedGlHeadsTx` (M1 supplies the list + the new nullable **`statement_class`** per head; adds **nothing** to the global `finance_major_heads`). **HoA/DDO skip** at **both** sites via one new `assertBillHeadValid(settings, head)` (delegates unchanged for govt; for commercial, head-exists check, NULL `hoa_code` valid per `chk_finance_heads_hoa_code`, bills store NULL `ddo_code`, and must **not** fall back to `DDO000001`/`FINANCE_DEFAULT_DDO_CODE`); default bill head 5400 resolved via **settings**, not the env vars (2202 is set in 3 places). Capture the vendor's **`udyam_category`** on the vendor master here (needed for 43B(h), §7 — can't be backfilled). Collision guard on seeding (§contract 3). **Effort:** ~3–4 d on S4. **Tests:** govt snapshot byte-identical; commercial bill passes without HoA/DDO at both sites; seed idempotent + collision-safe.

## 3. Gap M2 — Sales invoicing, customer master, AR (the core; largest)
Net-new. **Customer master** (name, GSTIN+regex, state/place-of-supply via a state-code master, PAN, credit terms). **Sales invoice** — line items (HSN/SAC, qty, rate, GST rate), intra/inter-state CGST+SGST vs IGST split (reuse `validateGstSplit` **copied into a shared `packages/gst`**, never a cross-service import of billing), **composition** path (bill of supply, no tax), place-of-supply/time-of-supply/advance-receipt vouchers, Rule-46 gapless numbering (`packages/numbering`), PDF (`voucher-print`), **status enum + immutability trigger** (UPDATE blocked once `status != 'draft'`). **Credit/debit notes** (s.34 timing). **AR:** decide **(a)** reuse `gl.finance_ar_ledger` with `source='sales_invoice'` + nullable `sales_invoice_id` + `customer_id→debtor_id` (cheaper, but mixes platform-billing rows) or **(b) new `ar` schema** (keeps billing untouched — **recommended for isolation**). Books of record = `gl.finance_ledger` (Dr AR 1300 / Cr revenue / Cr GST output 2300). AR ageing. Wire the **mobile** invoice sync route (tenant-gated 404/403 when govt). **Table spec (every new table):** `tenant_id NOT NULL`, ENABLE+FORCE RLS, `tenant_isolation USING(...) WITH CHECK(...)`, `UNIQUE(tenant_id, customer_code/invoice_no)`, composite FKs `(tenant_id, customer_id)` NOT VALID→VALIDATE, money BIGINT minor units + `CHECK(taxable+tax=total)`. **Effort:** ~10–12 d. **Dependency:** M1. 

## 4. Gap M3 — GST in the books (split per reviewer S4)
- **M3a (AP input tax; depends on M1):** post input-tax/ITC line on the vendor bill. **RCM** support (`rcm` flag on bill + self-invoice + separate RCM-payable head; Dr expense/Cr RCM output/Dr ITC, ITC after RCM paid). **Per-tax ITC heads** (IGST/CGST/SGST/Cess — a single 1700 is too coarse); **ITC categorisation** (eligible/ineligible/blocked s.17(5)). 
- **M3b (sales output tax; depends on M2):** post output-tax line on the sales invoice.
- **Wire the producer** `finance.gst.entry_record` **via the outbox in the same tx** as the GL line (not a separate async emit) so the ledger can't drift; **gate in the posting tx** (`settings.gstRegistered && coaTemplate != 'govt'`, skip/refuse never default-on) **and** defense-in-depth at the consumer (drop/non-retryably refuse entries for `gst_registered=false`). **`gl.finance_gst_ledger` fixes:** add `UNIQUE(tenant_id, source_doc_type, source_doc_id, gst_type, direction, rate_pct)` (partial, CONCURRENTLY — empty table, safe) and a `ledger_voucher_no`/`source_doc` link; make the slab validator read a new **effective-dated GST rate master** (don't hard-code 5/12/18/28 — 2025-26 rationalisation). Reconciliation test: GST ledger sum by head = head balance in `gl.finance_ledger`. **Effort:** ~6–7 d (3a+3b). **Dependency:** M1 (3a), M2 (3b). **GSTR-2B matching → v2.**

## 5. Gap M4 — GSTR-1 / GSTR-3B from the tenant's own transactions
**Build as NEW finance-service code** (reviewer S2) — do **not** re-point billing's `gstn/prepare.ts` (that would mutate platform SaaS filing; billing can't read `gl.*` anyway). Needs the richer invoice data M2 carries (place-of-supply, B2B/B2C type, document series). **GSTR-1 tables:** B2B, B2CL, B2CS, CDNR/CDNUR, exports, nil/exempt, **HSN summary** (mandatory, digit count by turnover VERIFY), documents-issued, advances (11A/B), amendments; **GSTR-3B:** 3.1/3.2/4/5/6 + interest/late fee, derived from the same ledger and reconciled to GSTR-1. **QRMP/IFF** monthly-vs-quarterly. **Pin the JSON schema version in config.** **v1 = prepare/JSON export; live GSTN filing = v2** (credentials). **Effort:** ~7–9 d. **Dependency:** M2, M3.

## 6. Gap M5 — e-Invoice (real data) + e-Way bill UI
Wire the IRN payload to real invoice+customer+tenant data (today mock + hard-coded); keep `EINVOICE_MODE=mock` default, live NIC behind credentials; honour the **30-day reporting window**. e-Way bill UI + invoice linkage + **per-state intrastate threshold table** (a single national figure is wrong; e.g. Delhi ₹1L vs ₹50k). **v2 — unless the pilot's turnover crosses the e-invoice threshold, then M5 is v1.** **Effort:** ~4 d. **Dependency:** M2.

## 7. Gap M6 — Udyam, MSMED/43B(h), sector module sets
**The driver is income-tax s.43B(h)** (FY23-24): a buyer's deduction is disallowed for micro/small-supplier dues unpaid past 15/45 days — needs the vendor `udyam_category` captured in **M1** (can't backfill), a year-end 3CD clause-22 disclosure, and interest at 3× bank rate (VERIFY). **MSME Form-1** half-yearly. Udyam registry **verification** (stub today); **don't auto-reclassify** (self-declared/registry). Wire `resolveMsmeModules` + `/config/screens` into the **module guard keyed on stored tenant modules/settings, not edition**, and **fix the manifest fail-closed** (never default `edition='small_office'` on error) before wiring. **Effort:** ~4–5 d. **Dependency:** M1.

## 8. Gap M7 — Retire `finance/simplified/`
Remove `app.ts:134-135`, `worker.ts:50`, module dir, 3 tests, 5 contract-baseline entries (intentional contract break → regenerate baseline). **First:** confirm no producer publishes to its topics (removing consumers would orphan messages); confirm **0 rows** in `simplified.{accounts,transactions}` on prod/UAT; keep migrations as history (no DROP SCHEMA). Harvest chart content only. **Framing:** a header-trust security cleanup — can run earlier than v2. **Effort:** ~1–2 d.

## 9. Gap M8 — Commercial statements (entity-type-driven)
A stored **`entity_type`** selects the statement family: **company → Schedule III** (P&L + BS + Cash Flow + Notes, AS or Ind AS by threshold VERIFY); **LLP → AS-based + Form 8/11**; **partnership/proprietorship → Trading + P&L + Balance Sheet** (ITR-3/4/5; 44AD/44ADA presumptive case VERIFY). **Classification stored, never inferred from the code prefix** (reviewer S6: `queries.ts:104` classifies `2xxx` as liabilities except 2202 — would misclassify commercial 2300 GST Payable). Basis-aware (accrual). Golden: govt output unchanged. **Effort:** ~6–8 d (two statement families). **Dependency:** M1–M3.

---

## 10. Backward compatibility, flags & fail-safe
Gated by `TENANT_PROFILES_ENABLED` + settings. **M0 migration** on `gl.finance_settings`: `gst_registered boolean NOT NULL DEFAULT false`, `gstin varchar(15) NULL` (CHECK: `gst_registered` ⇒ gstin not null + regex), `gst_effective_from date NULL`, `entity_type` enum; exposed on `FinanceSettings`; changed only via the **maker-checker approvals route** (like `accounting_basis`); `coa_template`/`profile_code` stay non-API-settable. `schema.sql ⇄ models ⇄ Alembic` kept in sync (repo rule). Existing tenants: `coa_template='govt'` → identical; govt golden byte-identical off AND on. **Fail-closed** by classification. **`coa_template` switch refused if any ledger rows exist** for the tenant (reviewer N1 — else govt-head history mixes with commercial); cash→accrual uses the built approved-switch flow with the 1-April effective-date rule.

## 11. Implementation plan & estimate (redone per panel)

| # | Slice | Depends | Effort |
|---|---|---|---|
| M0 | `gst_registered`/`gstin`/`gst_effective_from`/`entity_type` settings migration + approval path + widened lint + govt golden pins | — | 2 d |
| M1 | Commercial COA content + `statement_class` + `assertBillHeadValid` (both HoA/DDO sites) + vendor `udyam_category` + collision guard (on S4) | **S4**, M0 | 3–4 d |
| M2 | Customer master + sales invoice (+composition) + credit/debit notes + AR (new `ar` schema) + ageing + mobile sync + full table spec | M1 | 10–12 d |
| M3a | AP input tax + RCM + per-tax ITC heads + GST producer (outbox-in-tx) + gate + ledger uniqueness/rate-master | M1 | 4 d |
| M3b | Sales output tax | M2, M3a | 2–3 d |
| M4 | GSTR-1 (all tables) + GSTR-3B + QRMP/IFF, **new finance module** | M2, M3 | 7–9 d |
| M8 | Entity-type statements (Schedule III / Trading-P&L-BS / LLP) | M1–M3 | 6–8 d |
| M5 | e-invoice real data + e-way UI (**v1 if turnover > threshold**) | M2 | 4 d |
| M6 | Udyam verification + 43B(h)/MSMED + sector wiring + manifest fail-closed | M1 | 4–5 d |
| M7 | Retire `simplified/` (security cleanup; can run early) | M1 | 1–2 d |

**Core v1 (M0–M4, M8): ~38–48 dev-days; ~55–70 calendar days incl. per-PR review-and-re-review loops + regression pins + the pilot dry-run.** Critical path M0→M1→M2→M3b→M4/M8 (M3a parallels after M1). **S4 is a hard gate before M1.** Engage the CA before M2. Build only after sign-off.

## 12. What to reuse
`packages/tenant-profile`; `gl.finance_settings` + `approvals` maker-checker; `validateGstSplit` **copied into a new `packages/gst`** (not cross-service import); `packages/numbering`, `voucher-print`; `finance gst/` read API + ledger (wire the producer, fix the schema); `gl.finance_ar_ledger` (option a) or a new `ar` schema (option b); the `simplified/` chart content (data only); vendor-master/TDS; audit/outbox/RLS; setup-wizard visibility. **Do not** modify billing's `gstn/`/`einvoice/` for tenant returns — build tenant returns in finance-service.

## 13. Open questions for the owner (ordered)
1. **Pilot `small_office` tenant** (of 12), and its **entity type** (company/LLP/partnership/proprietorship), **GST status** (regular/composition/unregistered/QRMP), **turnover** (e-invoice threshold → M5 in v1?), and **goods-vs-services** mix.
2. **`simplified/`** — harvest its chart into the commercial COA then retire (and run the retirement early as a security cleanup)?
3. **AR** — reuse `gl.finance_ar_ledger` (cheaper) or a new `ar` schema (cleaner isolation, recommended)?
4. **v1/v2 split** (§0.5) approved? GST filing v1 = prepare/export, live filing v2?
5. **Statutory figures to confirm (VERIFY), named CA:** GST rates/HSN source+digit rule (2025-26 rationalisation); e-invoice & per-state e-way thresholds; RCM scope; ITC blocked-credit list; MSMED 43B(h)/interest/Form-1; Udyam classification thresholds; AS vs Ind AS; presumptive 44AD/44ADA; GSTR JSON schema versions; Income-tax Act 2025 renumbering.

## 14. Cross-cutting risks
1. Statutory correctness is the gating risk; config + effective dates + named CA engaged before M2; nothing here is law.
2. M2/M3 touch the central posting path (`gl.finance_ledger`); govt goldens pinned first, byte-identical, flags off and on; commercial logic is **new** functions selected by settings.
3. The GST surface spans 5 services — keep wiring additive, keep platform-billing GST (`billing_invoices`/`gstn/`) **untouched**, build tenant returns in finance-service.
4. Shared-host constraint: any pilot dry run uses a DB copy, obeying the vitest-worker memory guidance.
5. Migration numbering: next free finance = 0169, but 0165 (#2509) is an open PR — re-check at merge; each M-slice needs its own number; per-service numbering doesn't cross-collide.
6. `ON CONFLICT` collision + fail-closed-by-code would silently keep a tenant on govt heads — fail-closed checks `classification`.
7. Scope: live GSTN/e-invoice/e-way *filing integrations*, GSTR-2B matching, GSTR-9/9C → v2.

## 15. Reviewer panel disposition (revision 1 → 2)
Three independent lenses, 15 Nov; all APPROVE-WITH-CHANGES.
- **Domain/compliance:** entity-type (Schedule III only for companies) → `entity_type`-driven statements (B1); reverse charge added; per-tax ITC + s.17(5) categorisation; GSTR-1 breadth (B2CL/B2CS/CDNR/HSN/advances/amendments) + 3B tables; `gst_registered` as an enum (regular/composition/unregistered/QRMP); MSMED → **43B(h)** is the driver + vendor Udyam category in v1; e-invoice may be v1 by turnover; estimate redone.
- **Database:** head table is **`budget.finance_heads`** + new `statement_class` (B1); **AR sub-ledger already exists** (B2) → reuse-or-new decision; `gl.finance_gst_ledger` needs a uniqueness key + posting link + outbox-in-tx + reconciliation (B3); full M2 table spec; `gst_registered` M0 migration; `ON CONFLICT` collision guard; `simplified/` contract-baseline break + confirm 0 rows.
- **Architecture/isolation:** `gst_registered` needs a real settings home + approval path (B1); GST gate in the posting tx **and** at the consumer + unique index (B2); HoA/DDO skip at **two** sites via one new function (B3); widen the lint test; M4 as **new** finance code not a billing re-point; `simplified/` is a header-trust surface; manifest fail-closed before M6; split M3 into AP/sales; S4 a hard gate.
