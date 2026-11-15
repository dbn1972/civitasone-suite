# MSME / small-business (commercial) segment: paper design

**Status:** DESIGN for review. No code. Part of the segment roadmap (Section 8 → **MSME** → PSU). Companion to the tenant-profile switch (`docs/design/TENANT-PROFILE-SWITCH.md`, PR #2467 / merged #2468), whose `commercial` COA template is the other half of slice S4.

**Source:** repo `~/CivitasOne/civitasone-suite` at `origin/main` (`730f7558d`), read-only; an as-is capability map, 15 Nov 2026. Line numbers drift — re-grep before coding.

**Constraint:** parallel work, OFF the UAT server until the 18–20 Nov sign-off. Everything ships behind flags defaulting **false**; a merge after sign-off changes nothing until a flag is turned on per tenant.

**VERIFY** marks a statutory/legal figure or rule not confirmed from an authoritative source. Every threshold is effective-dated config with a named CA/counsel reviewer. No sentence states current law.

**Design-method note:** this doc was written *after* the Section 8 finance design's 3-lens review, so its data-model and isolation sections pre-apply those lessons (correct table placement, settings-column gating, Schedule III statements, lock-safe DDL). The same reviewer panel will still run on it.

---

## Cross-cutting contract (read first): configurable rules & tenant isolation

Owner standing rule: *reviewers always; no violation of other tenant types; configurable rules.* (See the shared governance memo; identical to the Section 8 design.)

1. **Data-keyed, never edition-forked.** No business-logic branch reads `edition`/`profileCode`/`family`. Commercial behaviour is gated by **stored settings**: `gl.finance_settings.coa_template` (`commercial`), `accounting_basis` (`accrual`), and a `gst_registered` flag — all resolved from the already-loaded settings row, once per posting. The profile catalogue only *seeds* these at onboard. **Enforcing lint test:** CI fails if any file under `finance-service/src/modules/{gl,payments,gst,financial-statements}` imports `getProfile`/`PROFILES` or reads `edition`.
2. **Flags default off.** `TENANT_PROFILES_ENABLED` (global activation) + per-tenant settings (`coa_template != 'govt'` gates commercial heads, GST posting, sales invoicing; `gst_registered` gates GST lines). With them off/govt, every tenant runs today's path.
3. **Additive-only, lock-safe.** New tables; new nullable columns (metadata-only `ADD COLUMN`); FKs `NOT VALID`→`VALIDATE` under `SET lock_timeout`; indexes `CREATE INDEX CONCURRENTLY`, **partial** where they only serve commercial rows; heads seeded `ON CONFLICT (tenant_id, code) DO NOTHING`. No row rewrite, no head rename/move, no govt-reachable function changes signature/default (commercial logic is new functions selected by settings).
4. **Proven isolation.** Golden tests compare full ledger rows, trial balance, Schedule III P&L/BS and year-end JSON for a seeded **govt** tenant, before/after migration, flags off AND on — byte-identical. Cross-tenant test: a `small_office` and a govt tenant in one DB; the govt tenant sees no GST lines, no customer master, no commercial heads; commercial routes 404/403 when `coa_template='govt'`.
5. **Fail-closed.** `coa_template='commercial'` but commercial heads absent (e.g. profile activated before S4) ⇒ refuse to post, never silently use govt heads.
6. **Reviewer panel, review-until-clean** on the design and every code slice.

---

## 0. Findings that shape the brief (as-is, with evidence)

1. **No tenant-side sales invoicing or AR exists — the core MSME flow is absent.** No customer master server-side (GSTIN only in the mobile form), no sales invoice with GST, no credit/debit notes. `billing-service` invoices are the **platform billing its tenants** (`invoices.billing_invoices.tenant_id` = the buyer; `billing-service/migrations/0021_gst_invoice_fields.sql`), not a tenant invoicing *its* customers. The only sales-invoice posting path is `finance/simplified/` (§0.4, no caller). Mobile has an invoice screen that **dead-letters** (no sync route; `sync_push_service.dart:83-86`). CRM has quotations/orders with GST fields (`crm 0111`) but no invoice.
2. **GST primitives exist but are scattered across 5 services and disconnected from the books.** Platform SaaS GST invoicing (billing); GSTN return filing UI+adapter (`billing-service/src/modules/gstn/`, env-gated, **aggregate-only**, totals *platform SaaS* invoices not tenant sales); e-Invoice/IRN (`billing einvoice`, **mock** default, hard-coded buyer GSTIN `00BBBBB0000B1Z5`/HSN `998311`/18%); e-Way bill (`stock-service eway-bill`, no web caller); finance GST ledger read API (`finance gst/routes.ts`) whose **producer is UNWIRED** — nothing enqueues `finance.gst.entry_record`, so `gl.finance_gst_ledger` is empty. **No GST line is posted on the AP bill or any sales path.** No GST rate master (only a slab list `gst/gst-rates.ts`), no HSN/SAC master, no tenant-level GSTIN in the books.
3. **`commercial` COA template is spec + column only.** `COA_TEMPLATES` names it (`packages/tenant-profile/src/index.ts:18`); `gl.finance_settings.coa_template` CHECK exists (`finance 0166`) but **nothing reads it to choose heads**. `standardGlHeads()` is one govt list (`gl/standard-heads.ts:49-98`, default bill head `2202 General Education`). No 5400/1700/2300/3000 anywhere. Seeding is one-size-fits-all (`tenant-onboard/consumer.ts:46-52`).
4. **`finance/simplified/` is dead-but-registered.** Routes registered (`app.ts:134-135`), worker consumers registered (`worker.ts:50,116`), its own flat MSME chart + GST auto-journal (`seed.ts`, `auto-journal.ts`) — but **no client** (grep found only the route file + contract baseline). Its edition guard trusts an `x-tenant-edition` header nothing sets. Retiring = remove registrations + module dir + tests + contract-baseline entries (schema/migrations stay as history). **Option:** harvest its flat chart / auto-journal templates as the commercial COA seed.
5. **`small_office` profile is `active:false`; today its tenants behave as govt.** Catalogue entry already relabelled "Small business / MSME", `family:commercial`, `accrual`/`advisory`/`commercial`/`commercial_in` (`index.ts:80-85`). `POST /v1/tenant/msme-onboard` captures `udyamNumber`/`category`/`sector`/`gstin` into `settings.msme` (`tenant/routes.ts:221-306`) but sets **no `profileCode`**, and almost nothing reads `settings.msme` (only the gateway screen manifest reads `sector`/`category`). **A `small_office` tenant gets the govt chart, DDO, and cash basis** because the profile is inactive and settings default to govt.
6. **Sector module sets + screen manifest are data without wiring.** `gateway-service/src/msme-modules.ts` `resolveMsmeModules` is **uncalled**; `/config/screens` (`screen-manifest.ts`) has **no consumer** in web/mobile. The real module gate `module-guard.ts` has no MSME reference.
7. **Accrual is partial.** `accounting_basis` cash|accrual exists (`finance 0160`) with an approved-switch flow (`approvals/apply.ts:175-234`); it governs a handful of postings. The AP bill path is accrual-shaped regardless (Dr expense/Cr AP `2050`) but posts **govt heads + requires an 18-digit HoA** — the hard commercial blocker (DDO is softened via the `DDO000001` default; the HoA is not). `accrualStoresHeads()` is never seeded at provisioning. Missing: prepaid/accrued heads, GST posting, commercial-format statements.
8. **Udyam/sector captured but unused.** `udyamNumber`/`category`/`sector`/`nicCode`/`gstin` stored in `settings.msme`, read by nothing except the manifest's `sector`. No Udyam registry verification, no MSMED Act 45-day payment tracking (§15/16), no MSME Form-1 half-yearly return, no turnover classification.
9. **Count correction:** the tenant-profile doc records **12 `small_office` tenants** (not ~18); `composition.tenant_profile` populated for only 1 of them. Re-derive the live count before relying on it.

---

## 0.5 Pilot tenant & v1 scope — the gating decision (owner question #1)

Unlike Section 8/DIC, MSME has **12 live `small_office` tenants** but no named pilot. The owner must pick the **reference tenant** and confirm its real needs (manufacturing vs trading vs services; GST-registered; e-invoice threshold applicability). That sets v1.

**Recommended v1 (the irreducible MSME core):** M1 commercial COA + activation, **M2 tenant-side sales invoicing + customer master + AR (the biggest gap)**, M3 GST in the books (wire the producer), M4 GSTR-1/3B from the tenant's own invoice-level data, M8 commercial Schedule III statements. **v2:** M5 e-invoice-real/e-way UI, M6 Udyam verification + MSMED 45-day + sector module wiring, M7 retire `simplified/`.

---

## 1. Relationship to the tenant-profile switch
- **Depends on (does not own):** S0–S1 (merged); **S4** (template-keyed `seedGlHeadsTx` — owns the mechanism; the `commercial` head list is content M1 supplies); **S5** (admin `small_office` bundle); `small_office.active=true`. §10 fail-closed covers the pre-S4 window.
- **The `simplified/` decision** (§0.4) is settled here: retire it (or harvest its chart) — M7.
- **Owns:** commercial COA content, sales invoicing + AR + customer master, GST-in-the-books, GST returns from tenant data, e-invoice/e-way wiring, Udyam/MSMED, commercial statements.

---

## 2. Gap M1 — Commercial COA + activation
Build the `commercial` head set (5400 Purchases/default bill head; 1500/1600/1700 advances/prepaid/**GST Input Credit**; 1800 TDS Receivable; 2300 **GST Payable**/2310 Income Tax Payable/2400/2500; 3000 Share Capital/3200 Reserves; 4400 Interest Income; 5410-5450 expenses; 6200 bank charges — per `TENANT-PROFILE-SWITCH.md §2.3`). Template-keyed seeding via **S4's** `seedGlHeadsTx` (M1 supplies the list, not the mechanism — don't duplicate). **HoA/DDO skip for non-govt bills** (the confirmed §0.7 blocker): `assertValidHoAWithMaster`/DDO checks (`payments/consumer.ts:176-180`) become template-aware — skipped when `coa_template != 'govt'`, replaced by a commercial head-exists check. Default bill head resolves to 5400, not the hard-coded 2202. **Effort:** ~3 d on top of S4. **Tests:** govt snapshot byte-identical; commercial bill passes without HoA/DDO; seed idempotent.

## 3. Gap M2 — Tenant-side sales invoicing, customer master, AR (the core; largest)
Net-new (nothing real exists, §0.1). **Customer master** (name, GSTIN+regex, state/place-of-supply, PAN, credit terms). **Sales invoice** with line items (HSN/SAC, qty, rate, GST rate), intra/inter-state CGST+SGST vs IGST split (reuse `billing invoices/domain.ts:125-165` `validateGstSplit`), numbering (`packages/numbering`), PDF (`voucher-print`). **Credit/debit notes.** **AR ledger** (Dr customer AR `1300`/Cr revenue `4xxx`/Cr GST output `2300`) — posts through the GL on the books of record (`gl.finance_ledger`), via a wired consumer (contrast the dead `simplified/` path). AR ageing report. Wire the **mobile** invoice sync route (currently dead-letters). **Effort:** ~7–8 d. **Dependency:** M1. **Tests:** invoice→GL posting with correct GST split; credit note reverses; AR ageing; govt tenant sees no customer/invoice tables (RLS).

## 4. Gap M3 — GST in the books (wire the unwired producer)
The GST ledger read-API + consumer exist (`finance gst/`); **nothing produces `finance.gst.entry_record`** (§0.2). Wire it from **both** posting paths: the AP bill (input tax / ITC line) and the M2 sales invoice (output tax). Add a **GST rate master** + **HSN/SAC master** (today only a slab list). ITC eligibility flag per purchase. Ring the GST output/input heads (2300/1700) into every taxable posting **inside the posting tx** so a direct journal route can't bypass. **Effort:** ~4 d. **Dependency:** M1, M2. **Tests:** bill posts input-tax line; invoice posts output-tax line; `finance_gst_ledger` populated; ITC reconciliation (`gst/routes.ts:75`) non-empty.

## 5. Gap M4 — GSTR-1 / GSTR-3B from the tenant's own transactions
The filing UI + adapter exist but total **platform SaaS invoices**, aggregate-only (§0.2). Re-point `gstn/prepare.ts` at the tenant's own **invoice-level** sales (M2) + purchases, build **B2B/B2C GSTR-1 JSON** and the **GSTR-3B table structure** the adapter lacks. Keep the adapter fail-closed unless `GSTN_ENABLED`. **Effort:** ~4 d. **Dependency:** M2, M3. **v1 = JSON export/prepare; live GSTN filing = v2** (needs credentials).

## 6. Gap M5 — e-Invoice (real data) + e-Way bill UI (v2)
e-Invoice is wired but mock with hard-coded buyer/HSN/rate (§0.2): wire the IRN payload to real invoice+customer+tenant data; keep `EINVOICE_MODE=mock` default, live NIC behind credentials. e-Way bill module exists server-side (`stock-service`) with no web caller: add UI + invoice linkage + mock/live check. **Effort:** ~4 d. **Dependency:** M2.

## 7. Gap M6 — Udyam, MSMED Act, sector module sets (v2)
Wire the captured `settings.msme`: Udyam registry **verification** (currently a stub comment); **MSMED Act §15/16 45-day payment tracking** on vendor bills (micro/small suppliers) + MSME Form-1 half-yearly return; turnover-based classification. Wire `resolveMsmeModules` + `/config/screens` into the module guard + web shell (today uncalled/unconsumed). **Effort:** ~4–5 d. **Dependency:** M1.

## 8. Gap M7 — Retire `finance/simplified/`
Confirmed dead-but-registered (§0.4). Remove `app.ts:134-135`, `worker.ts:50,116`, the module dir, its 3 tests, contract-baseline entries; keep the `simplified.*` schema/migrations as history. **Decision (owner Q):** harvest its flat chart / GST auto-journal templates as a seed for the commercial COA (M1) first, or discard. **Effort:** ~1–2 d. **Risk:** contract-baseline + a clean removal, reviewed.

## 9. Gap M8 — Commercial Schedule III statements
A `small_office` tenant is a **company** (or a firm) → **Schedule III** Balance Sheet + Statement of P&L (+ Cash Flow + Notes) under AS/Ind AS (**VERIFY** which; MSMEs often AS), **basis-aware** (accrual). The existing `financial-statements` routes produce a govt-style income & expenditure; add the commercial P&L/BS shape (gross profit, operating profit, tax) selected by `coa_template`. Golden: govt output unchanged. **Effort:** ~5 d. **Dependency:** M1, M2, M3.

---

## 10. Backward compatibility, flags & fail-safe
Gated by `TENANT_PROFILES_ENABLED` + settings (`coa_template`, `accounting_basis`, `gst_registered`). Existing tenants: `coa_template='govt'` → identical behaviour; govt golden byte-identical off AND on. Lint test bans `edition`/`getProfile` imports in finance posting modules. **Fail-closed** if commercial template active but heads absent. Activation strictly per-tenant, last; the cash→accrual switch for existing `small_office` tenants uses the built approved-switch flow (`approvals/apply.ts`) with the mid-year-distortion rule (effective 1 April).

## 11. Implementation plan & estimate

| # | Slice | Depends | Effort |
|---|---|---|---|
| M0 | Settings gates (`gst_registered`) + `fundContext`-style posting seam reuse + lint/golden pins | — | 1–2 d |
| M1 | Commercial COA content + HoA/DDO skip for non-govt bills (on S4) | S4, M0 | 3 d |
| M2 | Customer master + sales invoice + GST split + credit/debit notes + AR ledger/ageing + mobile sync | M1 | 7–8 d |
| M3 | GST-in-books: wire `finance.gst.entry_record` from bill+invoice; rate/HSN masters; ITC | M1, M2 | 4 d |
| M4 | GSTR-1/3B from tenant invoice-level data (prepare/JSON; live filing v2) | M2, M3 | 4 d |
| M8 | Commercial Schedule III P&L/BS (basis-aware) | M1–M3 | 5 d |
| M5 | e-invoice real data + e-way UI (v2) | M2 | 4 d |
| M6 | Udyam verification + MSMED 45-day + sector module wiring (v2) | M1 | 4–5 d |
| M7 | Retire `simplified/` (harvest chart first) | M1 | 1–2 d |

**Core v1 (M0–M4, M8): ~24–28 dev-days; ~35–45 calendar days incl. per-PR review-and-re-review loops + regression pins + the pilot dry-run.** v2 (M5–M7) ~9–11 days. Excludes S4/S5 prerequisites. Critical path M0→M1→M2→M3→M4/M8. Build only after sign-off.

## 12. What to reuse
`packages/tenant-profile`; `gl.finance_settings` + `approvals` machinery; `billing invoices/domain.ts` GST split + `validateGstSplit`; `packages/numbering`, `voucher-print`; `billing gstn/` adapter (re-point at tenant data); `einvoice`/`eway-bill` modules (wire real data); `finance gst/` read API + ledger (wire the producer); the `simplified/` flat chart + auto-journal (harvest for M1); vendor-master/TDS; audit/outbox/RLS; setup-wizard visibility.

## 13. Open questions for the owner (ordered)
1. **Pilot `small_office` tenant** — which of the 12, and its sector / GST-registration / e-invoice applicability? Sets v1.
2. **`simplified/`** — harvest its chart + auto-journal templates into the commercial COA, then retire; or discard?
3. **Statutory standard** — AS or Ind AS for the pilot (turnover-dependent, VERIFY); Schedule III form.
4. **v1/v2 split** (§0.5) approved? (Core = COA + sales invoicing + GST-in-books + returns + statements; e-invoice/e-way/Udyam = v2.)
5. **GST filing** — v1 prepare/JSON export only, or live GSTN filing (needs credentials)?
6. **Statutory figures to confirm (VERIFY):** GST rates/HSN source; e-invoice & e-way turnover thresholds; MSMED Act 45-day rule + Form-1; Udyam verification API; Income-tax Act 2025 impact.

## 14. Cross-cutting risks
1. Statutory correctness is the gating risk; config + effective dates + named reviewer; nothing here is law.
2. M2/M3 touch the central posting path (`gl.finance_ledger`); govt goldens pinned first, byte-identical, flags off and on; commercial logic is **new** functions selected by settings.
3. Shared-host constraint: any pilot dry run uses a DB copy, not the live UAT stack, obeying the vitest-worker memory guidance.
4. Migration-number coordination (next free finance = 0169; per-service numbering doesn't cross-collide).
5. The GST surface spans 5 services — keep the wiring additive and the SaaS-billing GST path (`billing_invoices`) untouched; don't conflate platform billing with tenant sales.
6. Scope: live GSTN/e-invoice/e-way *filing integrations* are v2 (credentials); v1 is books + prepare/export.
