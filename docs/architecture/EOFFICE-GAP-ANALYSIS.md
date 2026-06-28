# eOffice Gap Analysis — Prompt/Mockup Target vs Current Build

**Date:** 2026-06-28  
**Compares:** The AI-eOffice build prompt + 24-screen mockup (Ver 7.0 NIC eFile) vs CivitasOne `estab-service`  
**Question:** How much change is needed to make eOffice a deeply-integrated decision backbone?

---

## TL;DR

**Our architecture already matches the prompt's target.** The prompt proposes "a central eOffice service + event bus, modules raise files via SDK/events, approval matrix by role+amount, immutable audit." We built exactly that — and our immutability (DB trigger + hash chain) is **stronger** than the prompt specifies.

**Verdict: ~70% already done.** The gaps are mostly UI polish and 6 supporting features — NOT architecture. No rebuild needed.

---

## ✅ Phase 1 — Deep integration: DELIVERED (2026-06-28)

The functional deep-integration goal is now met. Shipped:

- **G1 — `@civitasone/eoffice-sdk`**: typed client (`EOfficeClient.raiseFile`,
  `getFileByRef`, `getDecisionLog`, `resolveApprovalChain`) + single-source-of-truth
  contracts (`SOURCE_REF_TYPES`, `MODULE_CALLBACK_TOPICS`, decision-callback schema).
  estab-service now imports these, eliminating contract drift. 11 unit tests.
- **G2 — config-driven approval matrix**: `files.estab_approval_rule` (migration 0008),
  amount-band resolver (max-exclusive, unbounded open-end, most-specific-band-wins),
  CQRS admin routes + `/resolve` preview, and the linkage consumer now auto-routes the
  approval chain from `source_context.amountMinor`. Admin UI at `/estab/approval-matrix`.
  4 resolver tests.
- **G5 — in-module raise control**: `<RaiseEOfficeNote>` reusable web component (live
  status badge + raise-for-approval form), wired into the finance sanction detail page;
  drops into PO/transfer/grant/legal screens with prop changes only.

Remaining work is signing (Phase 2), premium UI (Phase 3) and completeness features
(Phase 4) — none of which block deep integration.

---

| Layer | Match | Effort to Close |
|-------|:-----:|:---------------:|
| Domain model | 85% | Low |
| Architecture (service + events) | 95% | None |
| Cross-module integration | 80% | Low (SDK package) |
| Approval engine | 75% | Medium (matrix UI) |
| Immutability/audit | 110% (exceeds) | None |
| Signing (e-Sign/DSC) | 40% | Medium |
| UI (24 screens) | 35% | High |
| Supporting features | 30% | Medium |

---

## 1. Domain Model Comparison

| Prompt Entity | Our Equivalent | Status |
|---------------|----------------|:------:|
| `eoffice_file` | `files.estab_files` (+ source_ref_type/id, initiated_by, approval_chain) | ✅ Match |
| `eoffice_receipt` | `files.estab_inward` (DAK register) | ✅ Match |
| `eoffice_note` (green/yellow) | `files.estab_notings` (noteType yellow/green, noteStatus draft/submitted/approved) | ✅ Match |
| `eoffice_draft` (DFA) | ❌ Not a distinct entity (dispatch exists but no DFA lifecycle) | ⚠️ Gap |
| `eoffice_approval` | Delegated to `workflow-service` (workflow_instances/steps) | ✅ Match (different shape) |
| `eoffice_movement` | `files.estab_file_movements` (append-only) | ✅ Match |
| `eoffice_audit` | `audit-service` (every action emits audit.event.record) | ✅ Match |
| `eoffice_attachment` | `files.estab_file_attachments` | ✅ Match |
| `eoffice_signature` | `dscHash` + `signatureRef` on noting (no separate entity, no OTP flow) | ⚠️ Partial |
| `eoffice_approval_rule` (matrix) | ❌ Routing via workflow conditions, no config matrix table | ⚠️ Gap |

**State machines:**
- File: `draft → active → closed` — we have it. Prompt wants `draft → in_progress → pending_approval → approved/rejected/returned → closed → reopened`. **Minor: add intermediate statuses.**
- Note: `draft → submitted → approved` (green) + immutable — ✅ matches, and we enforce immutability at DB level (prompt only asks app-level).
- DFA: `dfa → approved → pending_sign → signed` — ❌ not built as entity.

---

## 2. Architecture Comparison

| Prompt Principle | Our Implementation | Status |
|------------------|-------------------|:------:|
| Central eOffice service every module talks to | `estab-service` | ✅ |
| Event bus for loose coupling | SQS + transactional outbox | ✅ |
| Modules raise file via SDK **or** event | `POST /files/from-module` + `estab.file.from_module` event | ✅ (HTTP, SDK pending) |
| Idempotency via `sourceModule+sourceType+sourceId` | `source_ref_type + source_ref_id` (indexed) | ✅ |
| eOffice emits `eoffice.file.approved/.rejected/.returned` back | `{module}.{entity}.file_decided` (15 topics mapped) | ✅ |
| Multi-division/tenant isolation | RLS + tenant_id on every table | ✅ |
| Single source of truth for approvals | Modules delegate to eFile + workflow | ✅ |

**This is the prompt's exact target architecture. No change needed.** The prompt would call our build "correct."

---

## 3. Approval Engine — The Key Nuance

**Prompt wants:** config-driven matrix `{module, sourceType, minAmount, maxAmount, steps:[role…]}` — e.g. PO sanction `0–5L → [Director]`, `5L–50L → [Director, CTO]`, `>50L → [Director, CTO, CEO]`.

**What we have:**
- `workflow-service` already evaluates **amount-based edge conditions** (`amount > 5000000` → route to CEO). Verified in `condition.ts` — supports `>`, `>=`, `<`, `<=`, `in`, AND/OR.
- So a workflow definition CAN encode "if amount > 50L, add CEO step." The capability exists.

**The gap:** There's no **admin UI / seed table** to define these thresholds as data (`eoffice_approval_rule`). Today an admin must author a workflow definition graph. The prompt wants a simpler amount-matrix table.

**Effort to close:** Medium. Add `estab_approval_rule` table + a resolver that picks the workflow definition by (module, sourceType, amount), + admin UI. The execution engine (workflow) needs NO change.

---

## 4. Immutability — We Exceed the Spec

| Prompt Asks | We Have | 
|-------------|---------|
| App-level immutable notes after movement | ✅ + **DB trigger blocks UPDATE/DELETE on frozen notings** |
| Append-only movement timeline | ✅ |
| Immutable audit log | ✅ (separate audit-service) |
| Signature hash recorded | ✅ `dscHash` SHA-256 + `prev_hash` chain |

**Our hash-chain + Postgres trigger means even a DBA with direct SQL access cannot tamper a frozen note.** The prompt only specifies application-level enforcement. We're ahead here.

---

## 5. Detailed Gap List + Effort

### Gaps requiring NEW work

| # | Gap | What's Missing | Effort | Priority |
|---|-----|----------------|--------|----------|
| G1 | ~~**eoffice-sdk package**~~ | ✅ DELIVERED 2026-06-28 | — | Done |
| G2 | ~~**Approval matrix table + UI**~~ | ✅ DELIVERED 2026-06-28 | — | Done |
| G3 | **DFA (Draft For Approval) entity** | Outgoing communication editor: template → type/upload → recipients → lifecycle dfa→approved→signed | 4 days | Medium |
| G4 | **e-Sign OTP + DSC adapters** | `Signer` interface; Aadhaar e-Sign OTP flow (mobile), DSC token (desktop); `estab_signature` entity | 5 days | High |
| G5 | ~~**In-module "Raise eOffice note" buttons**~~ | ✅ DELIVERED 2026-06-28 (RaiseEOfficeNote, wired into finance sanction) | — | Done |
| G6 | **24-screen premium UI** | Port mockup design system (navy/saffron/green tokens), two-pane File Inner Page, Noting editor, approvals queue | 10-15 days | Medium |
| G7 | **Supporting features** | Address book, transfer/handover, paper→electronic migration, acknowledgement generator, part/volume guided flow | 6 days | Low |
| G8 | **eOffice notifications center** | Unified stream: signature requested, overdue, pull-back, dispatch follow-up | 2 days | Medium |

### Gaps already covered (no work)

| Prompt Feature | Already Built |
|----------------|---------------|
| File create / inbox / inner page | ✅ estab files routes + web pages |
| Receipt/DAK diarise + inbox | ✅ inward register |
| Noting (green/yellow, versioned) | ✅ |
| Movement & closed files | ✅ |
| Dispatch (officer + CRU) | ✅ estab dispatch |
| Cross-module file raising | ✅ linkage module |
| Decision callbacks to modules | ✅ 15 topics |
| Multi-tenant isolation | ✅ RLS |
| Immutable audit | ✅ (exceeds) |
| Amount-threshold routing | ✅ (workflow conditions) |

---

## 6. Recommended Delta Plan (to reach "deep integration")

**Phase 1 — Integration depth (8 days):**
- G1: eoffice-sdk package
- G2: approval matrix table + resolver + admin UI
- G5: in-module "Raise eOffice note" buttons + status badges

This makes ANY module raise files in 3 lines and route by amount — the prompt's core promise. **After Phase 1, the deep-integration goal is met.**

**Phase 2 — Signing trust (5 days):**
- G4: e-Sign OTP + DSC + signature entity

**Phase 3 — UX uplift (12-15 days):**
- G6: port the 24 premium screens
- G8: notifications center

**Phase 4 — Completeness (6 days):**
- G3: DFA editor
- G7: address book, transfer, migration, acknowledgement

---

## 7. What Does NOT Need to Change

- ❌ **Don't rebuild the service** — architecture already matches
- ❌ **Don't replace the workflow engine** — it already does amount routing
- ❌ **Don't change the event model** — outbox + SQS is exactly what the prompt wants
- ❌ **Don't weaken immutability** — ours exceeds the spec
- ❌ **Don't fork eOffice into a new service** — estab-service IS the eOffice; it's already DB-separable (see EOFFICE-INTEGRATION-ARCHITECTURE.md §7)

---

## 8. Bottom Line

The prompt and mockup describe a system we have **already architected correctly**. The "central eOffice service + events + amount-matrix approvals + immutable audit + cross-module integration" target is built. 

**To make it the deep-integration decision backbone:**
- **Must-have (8 days):** SDK package + approval matrix UI + in-module raise buttons
- **Should-have (5 days):** e-Sign/DSC signing
- **Nice-to-have (18-21 days):** premium 24-screen UI + supporting features

**Total to full prompt parity: ~31-34 dev-days.** But the **functional deep-integration is achievable in the first 8 days** — everything after that is UX polish and convenience features, not capability.
