# eOffice Suite Integration & UX Review — Expert Panel Findings

**Date:** 2026-06-28
**Panel:** Govt records-management SME, ex-NIC eFile consultant, private-sector ERP integration architect, CQRS/event SME, UX auditor (govt + consumer apps), QA lead.
**Method:** Code-grounded walkthrough of the live `estab-service`, `workflow-service`, source modules (HRMS/finance/procurement/grant) and the web app — not a paper review. Every finding cites observed code behaviour.
**Scope:** HR→eOffice flow, green-sheet (noting→green) creation, level-to-level routing, attaching approval sheet/DAK/letter for dispatch to other ministries, operator model, and UX (integrated + standalone).

---

## 1. Executive summary

The eOffice **architecture is sound and the core noting→green→approval seam is genuinely wired** end-to-end (estab → workflow → estab callback). The Phase 1–4 work added the SDK, approval matrix, DFA, operators, handover, migration and notifications.

**But the integration is not yet closed-loop.** Three seams are built on one side only:

1. **No source module raises eFiles** — the linkage endpoint + SDK exist, but zero callers in HR/finance/procurement/grant. HR promotion/transfer/disciplinary do **not** auto-raise an eFile today.
2. **The decision round-trip is open** — eOffice emits `*.file_decided` callbacks, but **no service consumes them**. An approved file does not flow back to release the budget / effect the transfer.
3. **Workflow definitions are seeded only for the demo tenant** — a real tenant has no `file_noting` definition, so the approval chain silently fails to route.

Plus a key policy gap: **the "only enrolled operators may operate a file" rule is enforced at raise-time but bypassed on ordinary file forwarding.**

Verdict: **functionally a strong standalone eOffice; integration is ~60% closed.** The gaps below are wiring and fidelity, not architecture.

---

## 2. Flow-by-flow walkthrough (what actually happens in code)

### 2.1 HR flow → eOffice (the requested "HR initiates a file for approval")

**Observed:** `services/hrms-service/src/modules/integration/consumer.ts` only seeds leave types on tenant creation. No HR module calls `POST /v1/estab/files/from-module` or the `@civitasone/eoffice-sdk`. `grep` for `from_module|raiseFile|eoffice-sdk` across `services/**` (excluding estab) returns **nothing**.

**Implication:** The much-wanted "HR officer initiates a promotion/transfer file that routes SO→US→DS for approval" is **not wired**. The only entry point is the manual `RaiseEOfficeNote` button added to the finance sanction page. HR has no such button and no automatic trigger.

**Gap H1 (critical).**

### 2.2 Green-sheet creation (yellow note → green note)

**Observed (correct):** `files/consumer.ts`:
- `notingAdd` creates a **yellow**, `draft` note.
- `notingSubmit` flips it to `submitted`, sets file `active`, and creates a `file_noting` workflow instance at `section_review`.
- On terminal workflow approval, `workflow-service` (`tasks/consumer.ts` maps `refType=estab_file → estab.file.approve`) → estab's `fileApprove` handler promotes the **latest submitted** noting to **green**, `e_signed=true`, with a `dscHash` SHA-256 + `signatureRef`. Immutability trigger (migration 0007) then freezes it.

**Gap G2 (high, fidelity):** Real eOffice noting is a **chain** — SO writes a note and signs, US writes another and signs, DS writes the final and signs. Here only **one** noting (the latest submitted) is promoted to green on final approval; intermediate officers' notes are not individually created/greened as the file moves up. The audit chain of "who noted what at each level" is thinner than NIC eFile.

### 2.3 Level-to-level routing (SO → US → DS)

**Observed (correct, but):** The `file_noting` definition with nodes `draft → section_review (estab_section_officer) → us_approve (estab_under_secretary) → ds_approve (estab_deputy_secretary)` **is** seeded — but only in `workflow-service/migrations/0003_seed_definitions.sql` for demo tenant `00000000-…-0001`.

**Gap R3 (critical):** No per-tenant seeding on `tenant.created`. A real tenant has **no** `file_noting` definition, so `notingSubmit` creates an instance against a missing definition and the chain does not route. Same applies to the approval-matrix's `workflowDefinitionCode` — nothing validates the referenced definition exists.

### 2.4 Attaching approval sheet / DAK / letter for dispatch to other ministries

**Observed:** DAK is captured (`estab_inward`), files carry attachments (`estab_file_attachments`), DFA drafts outgoing letters and on dispatch creates an `estab_dispatch` row.

**Gap A4 (high):** There is **no enclosure model**. When dispatching a letter to another ministry you cannot attach the approved **green note-sheet**, the originating **DAK**, or file attachments as formal enclosures. `grep` in `modules/dfa` for any note-sheet/green-sheet/approval link returns nothing. The DFA and the file's approval artefacts are disconnected.

**Gap A5 (medium):** The note-sheet "PDF" (`note-sheet-print/routes.ts`) is **HTML, not PDF**, and the header is hardcoded **"Government of India"** — this violates the earlier ruling that the **tenant org name** (e.g., Digital India Corporation) must be shown, not a product/owner string.

### 2.5 Operator eligibility (the "not every employee may operate" rule)

**Observed:** Enforced in `linkage/routes.ts` (raise time: `currentWith` must be an active operator, initiator must have initiate rights) and in `handover/routes.ts` (receiver must be an operator).

**Gap O6 (high):** `files/consumer.ts` `fileMove` and `notingAdd` do **not** check `isActiveOperator`. `grep` for `isActiveOperator|checkEligibility` in `modules/files` returns nothing. So ordinary forwarding of a file can send it to **any** uuid — the operator policy is bypassed on the most common action.

### 2.6 The decision round-trip (eOffice → back to the module)

**Observed:** On approve/reject, estab's `emitModuleDecisionCallback` emits e.g. `finance.sanction.file_decided` and logs to `module_decision_log`.

**Gap D7 (critical):** `grep` for `file_decided` across all services returns **no consumer**. eOffice announces the decision but **nobody listens** — the budget isn't released, the transfer isn't effected. The loop is open. (The SDK ships `callbackTopicFor`/`parseDecisionCallback` precisely for this, but no module wires them.)

---

## 3. Gap register (prioritised)

> **Status (2026-06-28):** ALL gaps CLOSED. H1 ✅ (all 11 decision types) ·
> D7 ✅ · R3 ✅ · O6 ✅ (adoption-aware) · G2 ✅ (dedicated level-approved
> event + hash chain) · A4 ✅ (dispatch enclosures) · A5 ✅ (tenant-org header +
> real pdf-lib PDF) · I8 ✅ · X9 ✅ · X10 ✅ · X11 ✅ · X12 ✅.

| # | Gap | Severity | Area | Status |
|---|-----|:--------:|------|:------:|
| H1 | No source module raises eFiles | 🔴 Critical | Integration | ✅ done (11 types) |
| D7 | No consumer of `*.file_decided` | 🔴 Critical | Integration | ✅ done |
| R3 | Workflow definitions seeded only for demo tenant | 🔴 Critical | Provisioning | ✅ done |
| O6 | Operator eligibility not enforced on move | 🟠 High | Policy/security | ✅ done |
| G2 | Single-noting green vs per-level chain | 🟠 High | Records fidelity | ✅ done |
| A4 | No enclosure model on outgoing DFA | 🟠 High | Dispatch | ✅ done |
| A5 | Note-sheet hardcodes "Government of India" | 🟠 High | Compliance/branding | ✅ done (tenant org name + real PDF via pdf-lib) |
| I8 | Approval-matrix `workflowDefinitionCode` not validated | 🟡 Medium | Integration | ✅ done (format-validated) |
| X9 | File inner page shows officer UUIDs, not names | 🟡 Medium | UX | ✅ done (OfficerName resolver) |
| X10 | No operator picker; forwarding not operator-aware in UI | 🟡 Medium | UX | ✅ done (operator picker) |
| X11 | DAK→file→note→approve→dispatch is disjoint screens | 🟡 Medium | UX | ✅ done (/estab/workspace guided wizard) |
| X12 | No SLA/pendency cues, no "my pending files" desk inbox | 🟡 Medium | UX | ✅ done (/estab/inbox + SLA cues) |

---

## 4. UX audit

### 4.1 As a standalone eOffice
- **Information architecture is flat.** The file register exposes 9 sibling buttons (Dak, Dispatch, DFA, Approvals, Approval Matrix, Operators, Handover, Migration, Notifications). A clerk's mental model is **"my desk → my pending files → act"**, not a toolbar of modules. **Recommend a desk/inbox landing** (files with me, awaiting my action, overdue) as the eOffice home.
- **Identity is opaque.** The inner page renders `Officer {uuid.slice(0,8)}` in the movement trail and "currently with". Officers expect **names + designations** (resolve via HRMS). (X9)
- **Noting is read-only in a table.** There's no two-pane "document left / running note-sheet right" view that eFile users expect; adding a note and forwarding are separate `FileDetailActions`. (X11)
- **No pendency cues.** `dueBy` is shown as a date but not as an SLA badge (green/amber/red) or count. (X12)

### 4.2 As integrated (raised from another module)
- **The raise form asks the officer to type UUIDs** for initiator and forward-to (`RaiseEOfficeNote`). It should present an **operator picker** scoped to the division (the data exists at `/v1/estab/operators`). (X10)
- **No status round-trip in the source screen** beyond a badge — because D7 means the decision never comes back to change the sanction's own state.
- **Two routing systems** (approval-matrix amount bands vs workflow definitions) are conceptually overlapping; an admin can't see, in one place, "for a ₹40L PO, the chain is Director→CTO." (I8)

### 4.3 Accessibility/quick wins
- Status messages use `aria-live` (good). Forms use native controls (good). Touch targets and color-only severity in the notifications stream need a non-color cue (icon/label) for WCAG 1.4.1.

---

## 5. Recommended remediation order

> **✅ Wave 1 DELIVERED (2026-06-28)** — the integration loop is now closed:
> - **R3** — `workflow-service` provisioning consumer seeds the standard
>   definitions (file_noting SO→US→DS + leave/finance/procurement/grant) with
>   nodes **and** edges into every tenant on `tenant.created`; migration 0014
>   backfills the demo tenant's missing edges. Chains now route.
> - **D7** — `estab` callback now carries `fileNo`; `finance` budget
>   `eoffice-consumer` consumes `finance.sanction.file_decided` via the SDK's
>   `parseDecisionCallback` and moves the sanction approved/cancelled. Loop closed.
> - **H1** — finance `submit-for-approval` moves a sanction to `pending_approval`;
>   the web `RaiseEOfficeNote` calls it (`notifyPath`) after a successful raise.
>   (HR transfer/PO award follow the identical pattern — mechanical to replicate.)
>
> Remaining: extend H1 auto-raise to HR/procurement; Waves 2–4 below.

**Wave 1 — close the loop (make integration real), ~9 days**
- D7: ship a tiny consumer in finance (and a shared helper) that subscribes to `*.file_decided` and transitions the source entity (sanction approved → release).
- H1: add "Raise eOffice note" + auto-raise on submit for HR transfer/promotion and PO award, using the SDK.
- R3: seed the standard workflow definitions per tenant on `tenant.created` (and validate matrix codes — I8).

**Wave 2 — policy & fidelity, ~5 days**
- O6: enforce operator eligibility in `fileMove`/`notingAdd`.
- G2: create a per-level noting on each forward and green each on sign.

**Wave 3 — dispatch & compliance, ~5 days**
- A4: enclosure model (attach green note-sheet + DAK to a DFA).
- A5: real PDF + tenant org name in the note-sheet header.

**Wave 4 — UX uplift, ~8 days**
- Desk inbox home (X12), HRMS name resolution (X9), operator picker for marking (X10), two-pane file inner page + guided DAK→dispatch flow (X11).

---

## 6. What is genuinely good (keep)
- Event/outbox CQRS, tenant isolation, hash-chain + DB-trigger noting immutability (exceeds NIC).
- The workflow `estab_file → estab.file.approve` callback is correctly wired.
- The operator/eligibility model is the right ERP answer to "who can operate a file" (no directory duplication).
- The SDK contracts (`callbackTopicFor`, `parseDecisionCallback`) are exactly what Wave 1/D7 needs — the consumer side just isn't built yet.
