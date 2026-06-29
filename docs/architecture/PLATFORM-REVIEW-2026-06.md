# CivitasOne Suite — Multi-Lens Platform Review

**Date:** 2026-06-28
**Panel (parallel, read-only):** Government-ERP Domain Expert · Principal Distributed-Systems Architect · Security Architect (AppSec + DPDP/CERT-In) · QA Lead / SDET.
**Method:** each lens independently grep'd + read the actual source (and the QA lens ran typecheck + the test suites against the live dev Postgres). Findings below are code-grounded with file references; IDs map to the lens appendices (D=domain, A=architecture, S=security, Q=QA).

---

## 1. Verdict

The platform is **architecturally sound and domain-literate** — clean CQRS + transactional outbox, a complete 11/11 eOffice decision backbone, strong procurement SoD, race-safe money controls, 7th-CPC payroll depth, and genuinely good security primitives (JWT hardening, PII AES-GCM, audit triggers, double-entry bigint). Typecheck is green across all 47 packages.

**But it is not yet release-ready.** Three issues are corroborated by multiple lenses and must be fixed first:
1. **Tenant isolation (RLS) is not actually engaged at runtime** (S1/S4/Q7/D14) — isolation rests solely on app-layer `WHERE tenant_id`.
2. **The new silo multi-tenancy path is only partially wired** (A1/A2/A3) — enabling it today would split data and silo outbox would never publish.
3. **The CI `test` gate is red** from two deterministic, pre-existing test/code divergences (Q1/Q5).

Plus two domain-critical correctness bugs: **re-appropriation isn't zero-sum** (D1) and the **3-way match never reconciles the invoice amount** (D2).

---

## 2. Consolidated top risks (cross-lens)

| # | Risk | Lenses | Sev | Evidence |
|---|------|--------|:---:|----------|
| R1 | **RLS dormant** — `app.tenant_id` GUC never set in any service `src/`; `withTenantScope`/`setTenantGuc` have zero call sites; isolation = app-layer predicate only | S1, S4, Q7, D14 | 🔴 Critical | no GUC call sites; `current_tenant_id()` defs inconsistent (`,true` vs `,false`); estab RLS 0006 not even applied in test DB (`rls_enabled=false`) |
| R2 | **Prod compose defaults service DSNs to the Postgres superuser** → bypasses RLS, breaks least-privilege/DB-per-service | S2 | ✅ FIXED | `infra/docker-compose.prod.yml` — 62 superuser fallbacks now fail-closed (`:?`) requiring per-service least-priv DSN |
| R3 | **Audit log + eOffice notings wipeable via TRUNCATE** — `GRANT ALL` includes TRUNCATE; row triggers don't fire on TRUNCATE | S3 | ✅ FIXED | audit 0011 + estab 0011: `BEFORE TRUNCATE … FOR EACH STATEMENT` guards + `REVOKE TRUNCATE,TRIGGER`; verified TRUNCATE rejected even for owner |
| R4 | **Re-appropriation not zero-sum + mis-bounded** — no source head debited; `RE ≤ BE` cap forbids the very increase re-appropriation exists for | D1 | ✅ FIXED | now a guarded zero-sum transfer: `transferBudgetReMinorGuarded` debits source `re_minor` only if savings ≥ amount + credits target (no Rule-11 cap on target); `assertReappropriationValid` (GFR Rule 10); `from_budget_id` added (migration 0024); applied on both direct + eOffice-approval paths; 8 tests (domain + DB zero-sum/over-draw-reject) green |
| R5 | **"3-way match" never matches the invoice amount** — passes on two non-validated ref strings | D2 | ✅ FIXED | `assertThreeWayMatch` enforces tri-leg reconciliation (invoice ≤ GRN ≤ PO within tolerance, positive legs); procurement emits server-derived `poAmountMinor`/`grnAmountMinor` on `grn.accepted`; finance snapshots them on the bill + an AP read-model (`finance_grn_match`, migration 0025); approve gate reconciles, falling back to read-model for manual invoices; 13 tests (11 domain + 2 DB approve-gate) green |
| R6 | **Silo tier not production-wired** — `dbFor` only in estab notifications read; all writes/outbox/other 32 services use singleton `db`; outbox relay binds one pool conn; no pool→silo data cutover | A1, A2, A3 | 🔴 Critical (if silo enabled) | `services/*/src/shared/db.ts`, `packages/outbox startRelay` |
| R7 | **Money downcast to JS `number` at queue/event boundaries** — precision loss > ~₹9,007 cr | D3 | 🟧 Mostly fixed | shared codec `@civitasone/schemas/money` (`parseMinor`/`minorString` + zod fields, 7 tests). Queue/event boundaries converted to exact string paise: **finance** (sanction.approved, payment.made ×2, gem match, GRN→bill draft), **procurement** (grnAccepted grossMinor+item rateMinor, tender→PO unitPriceMinor), **asset** (disposal proceeds, GRN-capitalization acquisitionCost); consumers decode tolerantly (BigInt/parseMinor). finance 126 / procurement 70 / asset 28 / stock 11 / inventory 19 / grant 37 / payroll 184 green. Remaining: route validators accepting decimal strings (safe-range numbers OK today), payroll payslip jsonb (tiny component amounts), presentation-layer rupee display |
| R8 | **CI `test` job red** — 2 deterministic failures block the release gate | Q1, Q5 | ✅ FIXED | procurement PO draft→pending lifecycle test corrected (14/14); tenant dedupe test uses valid-UUID messageId (9/9) |
| R9 | **DSC hash/noting lost on decision callback** — approval can't be tied to the e-signed green note | D5, A5 | ✅ FIXED | `fileApprove` captures the noting id + dsc_hash from the signing call (no longer re-queries `findLatestSubmittedNoting` after the status flip); callback + `module_decision_log` now carry the signed note's id/hash; DB test asserts the binding |
| R10 | **Two signing paths; backbone path skips the hash chain** — notes approved via the cross-module path sit outside `prev_hash`/`chain_seq` | D6, A6 | ✅ FIXED | `fileApprove` now green-signs via `signNotingChain` (same path as manual/level signing) so it accrues `prev_hash`/`chain_seq`; also fixed a latent bug — `signNotingChain` bound a JS `Date` into raw SQL (threw); now uses `to_timestamp(ms)` consistent with the hash input; DB test asserts `chain_seq` |
| R11 | **Direct sanction creation self-approves** — single officer raises an already-approved sanction (maker-checker bypass) | D4 | ✅ FIXED | `sanctionCreate` now inserts `pending_approval` + emits no approved event; new SoD-guarded `finance.sanction.approve` (checker ≠ maker, `assertSanctionApproverDistinct`) or the eOffice loop approves; bills may only draw on an `approved` sanction (`SANCTION_NOT_APPROVED`); 5 tests green |
| R12 | **`x-internal` shared secret grants super_admin on any tenant** (non-constant-time compare) | S5 | ✅ FIXED (compare+audit) | secret now compared with `timingSafeEqual` (length-guarded, no timing oracle); every internal elevation is audit-logged (caller/tenant/path/ip, secret never logged); 5 plugin tests green. Full replacement with per-service signed identities (mTLS / short-lived JWT `aud`) remains a separate infra track |
| R13 | **Missing workflow definition → unguarded rubber-stamp approval** — eOffice chains bypass SO→US→DS when `approvalChain` code isn't a seeded definition | A4 | ✅ FIXED | `instances/consumer.ts createInstance` now fails closed: a `definitionCode` that doesn't resolve to a seeded definition yields a `rejected` instance with NO approval task (no one-click rubber-stamp) + `instanceRejected` event; resolvable codes still drive the real chain; 2 tests + 86 suite green. (Standard chains incl. `file_noting` are seeded in the provisioning catalog) |
| R14 | **Grant disbursement: eOffice approval doesn't trigger the payout** (direct path already pays; approval path only sets state) | D7 | ✅ FIXED | new opt-in `requireApproval` holds the disbursement in `pending_approval` (gates run, scheme budget reserved) WITHOUT paying; the eOffice approval emits the single EFT (approval before payment) + marks the installment disbursed; rejection releases the reserved budget; `eft_emitted` guard guarantees pay-at-most-once (legacy already-paid rows never re-paid); default immediate-pay path unchanged. Latent fix: disbursement status CHECK omitted `pending_approval`/`cancelled` (migration 0006). 4 tests + grant 41 green |
| R15 | **Finance by-id repo reads omit tenant predicate** (IDOR if RLS stays dormant) | S6 | ✅ FIXED | added tenant-scoped reads (`findSanctionByIdAndTenant`, `findBillByIdAndTenant`, `findPaymentByIdAndTenant`); all user-facing query loaders (sanction available/detail, payment, bill detail, payment→bill vendor lookup) now scope by tenant at the DB read, not just post-fetch; suite 126 green |
| R16 | **Integration tests share one live Postgres, incomplete cleanup** — rerun flakiness (asset GRN inbox row; estab `estab_inward` unique key) | Q2, Q3, Q4 | ✅ FIXED | asset test clears derived uuidV5 processed ids (17/17 ×2); estab `wipe()` clears `estab_inward` (11/11 ×2); both proven rerun-stable |
| R17 | **Vendor blacklist tenant-scoped only** — CVC debarment not government-wide | D8 | 🟡 Med | `vendor-blacklist/repo.ts` |
| R18 | **GRN requires full receipt** — partial/part-supply deliveries blocked | D10 | ✅ FIXED | `computeThreeWayMatch` no longer demands `received >= ordered`; partial receipts match when within PO bounds (accepted ≤ received ≤ ordered) and total accepted > 0; over-acceptance/empty receipt/failed inspection still rejected; bill drafts at the accepted value (ties to R5); tests updated + procurement 70 green |
| R19 | **Major CCS(CCA) penalty imposed on single approval** — skips Rule 14 inquiry | D11 | ✅ FIXED | eOffice imposition gate now calls `assertMajorPenaltyInquiry` (charge memo + inquiry officer + recorded finding required for a major penalty/proceeding); without it the case stays `pending_approval` and logs `major_penalty_blocked_rule14`; minor penalties unaffected. Also fixed a latent bug — the case status CHECK omitted `pending_approval` (migration 0029), which broke submit-for-approval. 6 tests + hrms 271 green |
| R20 | **qa-readiness score measures test-file presence, not pass/coverage** | Q6 | ✅ FIXED | the 25-pt testing band now uses MEASURED line/statement coverage from vitest's `json-summary` (`coverage/coverage-summary.json`) when present; falls back to presence only when coverage wasn't run (release gate unchanged); reports `coverageMeasured`/`coveragePct`. vitest config now emits `json-summary` |
| R21 | Orphaned callbacks (procurement_award/grant_scheme/hr_leave_special/hr_recruitment emitted-capable, no consumer); `x-internal` aside | A12 | ✅ FIXED | `@civitasone/eoffice-sdk` adds `DECISION_CONSUMED_REF_TYPES` + `isDecisionConsumed`; the estab linkage raise path now fails closed — a from-module raise whose decision no module consumes is rejected + audited (`raise_rejected_no_decision_consumer`) instead of creating an orphaned file whose approval is silently lost; 5 SDK + 2 DB tests |
| R22 | CI workflow expression bugs (unquoted `push`/`refs/heads/main`/`./package.json`) → docker-build on main never fires | Q11 | ✅ FIXED | `ci.yml` docker-build `if:` now quotes `'push'`/`'refs/heads/main'`; version step uses `node -p 'require("./package.json").version'` with correct quoting |

---

## 3. What is genuinely strong (keep)

- **eOffice decision backbone:** all 11 source types execute the correct domain effect on approval (sanction→approved+event, payment→released, PO→approved, transfer→posting applied, promotion→designation/pay, grant→initiated, asset→disposed+GL, legal→issued, contract→awarded), each tenant/status-guarded and idempotent.
- **CQRS + outbox:** stable-messageId republish, `ON CONFLICT` `markProcessed`, events only inside the outbox tx; no route writes Postgres directly (arch-guard enforced).
- **Procurement controls:** maker/checker/tech-evaluator SoD, sealed two-envelope L1 in pure BigInt, blacklist+sanction gates re-checked inside award/PO transactions, gapless numbering after gates.
- **Money/GL:** balanced debit/credit in bigint paise, deterministic journal ids, period close, race-safe guarded UPDATEs.
- **Security primitives:** RS256/JWKS + HS256 fail-closed + audience validation; AES-256-GCM PII with keyring/rotation + blind index; audit append-only trigger + REVOKE (modulo TRUNCATE); DPDP anonymise-not-delete; secret refs (`db_dsn_ref`/`kms_key_ref`) excluded from the tenant API projection.
- **Workflow engine:** row-locked SoD, version pinning, fail-closed condition parser, cycle/fork-bomb guards.
- **Multi-tenancy keystone unit tests** (7/7) and **eoffice-sdk** (13/13) are clean.

---

## 4. Remediation roadmap

### Wave A — release blockers (must fix before GA)
- **R3 ✅ DONE** — TRUNCATE guards + REVOKE on `events.events` and `files.estab_notings` (+ `module_decision_log`); verified.
- **R2 ✅ DONE** — prod compose fails closed; no superuser DSN fallback.
- **R1 (RLS) — runbook ready** (`RLS-ENGAGEMENT-RUNBOOK.md`): standardize `current_tenant_id()` to `,true` → wire `withTenantScope` GUC at read/write boundaries per service → switch to non-bypass `*_svc` roles → blocking cross-tenant rejection test per service → decommission bypass. Sequenced so isolation engages only after the GUC is wired (never a big-bang).
- **R4 (re-appropriation):** model as a zero-sum transfer (from-head/to-head, assert source savings ≥ amount, allow receiving RE > BE within sanctioned grant).
- **R5 (3-way match):** enforce real tri-leg PO↔GRN↔invoice reconciliation within tolerance; validate poRef/grnRef resolve to tenant-scoped rows for the same vendor.
- **R8 (CI red):** decide PO create status (draft vs pending) and fix consumer/test; fix the tenant dedupe test to use valid-UUID messageIds.

### Wave B — high (fast-follow)
- **R7:** carry money as decimal strings end-to-end; rebuild with BigInt at boundaries.
- **R9+R10:** capture noting id/hash before the status flip and pass it to the callback; route ALL green-signing through `signNotingChain`.
- **R11:** create sanctions as `pending_approval`; require the maker-checker/eOffice path.
- **R12:** replace `x-internal` shared secret with per-service signed identities (mTLS/short-lived JWT `aud`), scoped roles, constant-time compare, audit every elevation.
- **R13:** seed eOffice approval-chain workflow definitions per tenant; reject `from-module` raises whose `approvalChain` doesn't resolve (don't silently rubber-stamp).
- **R6 (silo):** do NOT enable silo for any tenant until `dbFor` + per-tenant outbox routing are rolled across services and a pool→silo cutover exists. (Keystone + provisioning are in place; the per-service rollout is not.)

### Wave C — medium / hardening
- R14 grant payout sequencing · R15 tenant predicate in finance repos · R16 self-isolating integration tests (truncate `_inbox`/`_outbox`/side-effects, unique tenant per run) · R17 federated CVC debarment · R18 partial GRN · R19 major-penalty inquiry gate · R20 qa-score on real coverage · R21 orphaned callbacks · R22 CI expression fixes.

---

## 5. Bottom line

The architecture and domain modelling are strong and largely production-shaped; the eOffice integration is genuinely differentiated. The release-blocking work is concentrated and well-defined: **make RLS real (R1–R3), fix the two domain-correctness bugs (R4, R5), and green the CI test gate (R8).** Silo multi-tenancy should stay behind its flag until Wave B/R6 completes. None of this is a redesign — it is hardening and finishing the wiring already started.
