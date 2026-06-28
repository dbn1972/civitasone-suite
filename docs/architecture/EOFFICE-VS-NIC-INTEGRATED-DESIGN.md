# NIC eFile (Ver 7.0) vs CivitasOne Integrated eOffice — BA Analysis & Design

**Date:** 2026-06-28
**Source studied:** NIC eOffice **eFile User Manual Ver 7.0** (`docs/reference/eOffice_eFile_User_Manual_Ver_7.0.pdf`, downloaded; text extracted to `eoffice_manual_text.txt`).
**Panel:** Govt records-management BA, ex-NIC eFile implementer, ERP solution architect, integration architect.
**Question:** NIC eFile is a **standalone** records system. We want eOffice to be the **decision backbone of the ERP** — every financial/HR/procurement decision raised *into* a file and the file's decision flowing *back* to execute in the module.

---

## 1. What NIC eFile actually does (from the manual's table of contents)

The manual describes a **self-contained file/records lifecycle**:

| NIC eFile area | Sub-features (from manual) |
|----------------|----------------------------|
| **Diarisation of DAK** | Create receipt from inward letter; created-receipt list |
| **Receipt Inbox** | Inbox, sub-folders, move receipts between folders, folder management |
| **Receipt P/E** | Edit Physical/Electronic receipt details; receipt details view |
| **Receipt → File** | Put a receipt inside a file; **convert receipt**; receipt attachments; attach files/receipts together; detach |
| **Draft Communication (DFA)** | Create draft, list of drafts, edit draft in an electronic receipt, **add/edit recipient**, **approve draft**, **sign draft (eSign/DSC)** |
| **Dispatch** | Dispatch from receipt; dispatch register |
| **Files** | Create file (electronic/physical), noting (yellow/green), file movement, references, **part file**, file closing/reopen |
| **Movement** | Send/forward file to officer; movement trail; pull-up |
| **Migration** | Migrate physical files into the electronic system |
| **VIP / References** | VIP references, linking receipts/files |
| **Signing** | **eSign (Aadhaar OTP)** and **DSC** on notes and drafts |

**The defining characteristic: it is isolated.** A draft, note or dispatch in NIC eFile has **no concept of a financial sanction, a budget head, a vendor PO, an HR transfer order, or a workflow approval matrix.** An officer manually creates a file, manually types a note, manually routes it. The "decision" lives only as free text in a green note — nothing downstream *executes* because of it. Integration to other systems is via manual re-keying or out-of-band APIs.

---

## 2. The fundamental difference we are building

> **NIC eFile = a digital filing cabinet. CivitasOne eOffice = the decision engine wired into the ERP.**

```
          NIC eFile (isolated)                 CivitasOne (integrated)

   Officer ── types note ── green note     Finance PO ─raise─▶ eOffice File
                  │                                              │
                  ▼                          amount-matrix routes SO→US→DS
            (dead end — text only)                               │
                                              green note + eSign  │
                                                                  ▼
                                            decision ─callback─▶ PO sanctioned
                                                                 budget released
```

Every ERP decision (sanction, payment, PO award, promotion, transfer, grant) should be:
1. **Raised into** eOffice as a file (with the source entity linked + amount/context).
2. **Routed** by the approval matrix (by module + amount band) through the desk hierarchy.
3. **Decided** with a green, eSigned note (immutable, hash-chained).
4. **Flowed back** to the originating module to **execute** (release budget, issue PO, effect transfer).

This is the inversion of NIC eFile: the file is not the destination, it is the **control point** between an ERP intent and its execution.

---

## 3. Feature parity + integration map (NIC eFile → CivitasOne)

| NIC eFile feature | CivitasOne status | Integration delta we add |
|-------------------|-------------------|--------------------------|
| Diarise DAK / receipt inbox | ✅ `estab_inward` (DAK register) | Auto-diarise inbound from notification/citizen RTI |
| Receipt → File / convert | ✅ file create from inward | Same |
| Receipt attachments | ✅ `estab_file_attachments` | + **enclosure of approved green-sheet** (Wave 3 A4) |
| **Noting yellow→green** | ✅ + DB-trigger immutability + hash chain (**exceeds NIC**) | per-level note chain (Wave 2 G2) |
| **DFA create/approve/sign** | ✅ `estab_dfa` lifecycle | eSign/DSC = Phase 2 |
| Dispatch | ✅ `estab_dispatch` | dispatch to ministry with enclosures |
| File movement / pull-up | ✅ `estab_file_movements` | **operator-eligibility gate** (Wave 2 O6) |
| Migration (physical→electronic) | ✅ `estab_migration_register` | Same |
| Hierarchy routing (SO→US→DS) | ✅ `workflow-service` file_noting + per-tenant seed | **amount-matrix** decides the chain (NEW vs NIC) |
| eSign (Aadhaar OTP) / DSC | ⚠️ recorded, crypto deferred (Phase 2) | — |
| **Link to ERP entities** | 🟢 **NEW — not in NIC** | `source_ref_type/id`, SDK raise, decision callbacks |
| **Approval matrix by amount** | 🟢 **NEW — not in NIC** | `estab_approval_rule` resolver |
| **Decision executes in module** | 🟢 **NEW — not in NIC** | `*.file_decided` consumers (Wave 1 D7) |
| **File operators (eligibility)** | 🟢 **NEW — not in NIC** | division-admin desk enrolment |

**Conclusion:** for the *records* lifecycle we are at parity (and ahead on immutability). The **integration layer is entirely net-new vs NIC** — and that is the product's reason to exist.

---

## 4. The integration contract (how every decision links)

Two directions, both already built (finance is the reference implementation):

**A. ERP module → eOffice (raise for decision)**
- `@civitasone/eoffice-sdk` → `POST /v1/estab/files/from-module`
- payload carries `refType` (e.g. `finance_sanction`), `refId`, `subject`, `dept`, `context.amountMinor`.
- the source entity moves to `pending_approval` (H1).
- approval matrix resolves the chain from the amount; file routes the desk hierarchy.

**B. eOffice → ERP module (decision executes)**
- on green/approve, eOffice emits `{module}.{entity}.file_decided` with `fileId, fileNo, refType, refId, decision, dscHash`.
- the module's consumer (`parseDecisionCallback`) transitions the entity and runs the side effect (release budget / issue PO / effect transfer).

This contract is **uniform across modules** — adding a new decision type is: pick a `source_ref_type`, add a callback topic, add a one-screen raise button, add a `file_decided` consumer. ~½ day per decision type.

---

## 5. Coverage of the suite's decisions (what to wire next)

| Decision | source_ref_type | Raise | Callback consumer |
|----------|-----------------|:-----:|:-----------------:|
| Finance sanction | `finance_sanction` | ✅ | ✅ |
| Finance payment | `finance_payment` | ✅ (API) | ✅ |
| Re-appropriation | `finance_reappropriation` | ☐ | ☐ |
| Procurement award/PO | `procurement_po` | ✅ | ✅ |
| HR promotion | `hr_promotion` | ☐ | ☐ |
| HR transfer | `hr_transfer` | ✅ | ✅ |
| HR disciplinary | `hr_disciplinary` | ☐ | ☐ |
| Grant scheme/disbursement | `grant_disbursement` | ✅ (API) | ✅ |
| Asset disposal | `asset_disposal` | ☐ | ☐ |
| Legal opinion | `legal_opinion` | ☐ | ☐ |
| Contract award | `contract_award` | ☐ | ☐ |

**Wired end-to-end (2026-06-28):** finance sanction (web+API), procurement PO
(web+API), HR transfer (web+API), finance payment (API), grant disbursement
(API). Each follows the identical raise → `*.file_decided` → execute pattern via
`@civitasone/eoffice-sdk` (`onDecision`/`parseDecisionCallback`). Remaining
types (re-appropriation, HR promotion/disciplinary, asset disposal, legal
opinion, contract award) are the same ~½-day pattern each.

---

## 6. Recommended build order (BA)

1. **Generalise the raise + callback** so adding a decision type is config, not code:
   - a shared `@civitasone/eoffice-sdk` **callback consumer helper** that a module registers with a `(decision, refId) => effect` handler.
   - a generic `RaiseEOfficeNote` (done) dropped on each module's detail screen.
2. **Wire the high-value decisions first:** procurement PO award, HR transfer/promotion, finance payment, grant disbursement (covers ~80% of govt approvals).
3. **Wave 2 fidelity:** operator-eligibility on movement (O6); per-level green notes (G2).
4. **Wave 3 dispatch:** attach the approved green-sheet + DAK as enclosures on outgoing DFA to other ministries (A4); real PDF + tenant org name (A5).
5. **Phase 2 trust:** eSign (Aadhaar OTP) + DSC on notes/drafts — matches NIC's signing, which we currently record but don't cryptographically perform.

---

## 7. Bottom line for the sponsor

- We have **NIC eFile's records capability** (and exceed it on tamper-proofing).
- We have the **integration spine NIC lacks** — ERP→file→decision→execute — proven end-to-end for finance sanctions.
- "Make it integrated for every decision" = replicate the proven finance pattern across the remaining ~11 decision types (mostly mechanical), plus operator-gated movement, per-level notes, and ministry-dispatch enclosures.
- The differentiator vs NIC eFile and vs Frappe/SAP DMS: **the file is the approval control point of the ERP, not a separate filing system.**
