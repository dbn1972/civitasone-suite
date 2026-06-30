# eOffice Suite — Government of India Office-Procedure Compliance & Gap Analysis

**Date:** 2026-06-30
**Scope:** `estab-service` eOffice/eFile suite (17 modules, migrations 0001–0017)
**Baseline:** CSMOP (DARPG, 2022 ed.), NIC eOffice/eFile, Record Retention Schedule, Public Records Act 1993 + Rules 1997, Manual of Office Procedure.
**Method:** Direct verification of schemas + domain logic (not memory). Stricter than the earlier narrow CSMOP audit (89/100) because it also scores org hierarchy, file-type taxonomy, record-room, archival, and full NIC eOffice parity.

---

## 1. Executive Summary

**Overall compliance: ~77% — Maturity: GOOD → ADVANCED (receipt-to-weeding core is strong; structural/records-room/archival edges are thin).**

The file-lifecycle spine — DAK → diary → file open → gapless numbering → note-sheet (immutable, hash-chained) → correspondence/PUC → DFA → approval (maker-checker) → eSign → dispatch → movement → disposal-gated closure → retention → weed-out — is **implemented and tested** to a high standard. The gaps are concentrated in five areas: **organization hierarchy, file-type taxonomy, referencing depth, record-room/archival, and NIC eOffice feature parity.**

### Top gaps (by severity)
| # | Gap | Severity |
|---|-----|----------|
| 1 | No formal org hierarchy entity (Ministry→Dept→Wing→Division→Section) | **High** |
| 2 | No file-type taxonomy (part files, volumes, linked/standing-guard files) | **High** |
| 3 | DFA draft versioning absent + DFA number not gapless (`Math.random()`) | **High** |
| 4 | Record-room physical location & issue/receipt registers absent | Medium |
| 5 | Archival workflow + NAI transfer (Cat-A) not distinct from closure | Medium |
| 6 | Referencing to rules (FR/SR/GFR)/precedent/cross-file not modelled | Medium |
| 7 | Records Officer role + annual review register absent | Medium |
| 8 | NIC eOffice parity gaps (templates library, file cover, VIP/Parliament refs, KMS/collab) | Medium |
| 9 | Diary/DAK number operator-supplied, not system gapless | Low |
| 10 | Conditional/partial approval not explicitly modelled | Low |

---

## 2. Compliance Matrix (receipt → archival)

| Process area | GoI requirement | Current system behaviour (evidence) | Gap | Severity | Compliance |
|--------------|-----------------|--------------------------------------|-----|:--------:|:----------:|
| **Org hierarchy** | Ministry→Dept→Wing→Division→Section, hierarchy-driven routing | `estab_file_operator` has free-text `division`/`section`/`deskRole`/`clearance_level`; files carry `dept` text. No formal 5-level org entity; routing is operator-based not hierarchy-derived. | No org-structure model; no Ministry/Wing levels | **High** | 40% |
| **Receipt (DAK)** | All inward (letter/email/scan) diarised with full metadata, attach/detach | `estab_inward`: sender, subject, mode, language, urgency, category, received/due dates, barcode, sourceSection, status; attach-to-file + detach-with-reason; `estab_inward_movements` | Email/scan auto-ingest not evidenced | Low | 90% |
| **Diary** | Sequential diary register | Inward register + movement history; `dak_no` carried | DAK/diary no. is operator-supplied, not system-gapless | Low | 80% |
| **File opening** | One-subject-one-file; open from receipt | `createFile` + `openFileFromInward` (receipt→file) | Duplicate-subject prevention not enforced | Low | 90% |
| **File numbering** | Section/subject/serial/year, immutable, gapless | `allocateFileNo` → `<SECTION>/<00001>/<year>` via `estab_doc_seq` (atomic, gapless); immutable after creation | No subject/standard-head component; legacy-no. mapping partial | Medium | 80% |
| **File types** | Part files, volumes (Vol I/II), linked files, standing guard files | Only `classification` + `status` (draft/active/closed/archived); `parent_file_id` exists | No part/volume/linked/standing-guard taxonomy | **High** | 25% |
| **File classification** | Top Secret/Secret/Confidential/Public + access control | `FILE_CLASSIFICATIONS` + operator `clearance_level` + `isAccessAllowed`; denials audited; top-secret read break-glass | — | — | 90% |
| **Note sheet (green)** | Sequential, attributable, tamper-proof, agree/disagree/return | `estab_notings` seq + officer designation/section snapshot; truncate guard + SHA-256 hash chain; submit/approve/reject; eSign | — | — | 90% |
| **Correspondence (yellow)** | All in/out comms, page numbers, office copy, stable refs | `estab_correspondence`: `corr_no`, direction, stable `page_from/page_to`, office-copy flag, party, letter ref/date | — | — | 90% |
| **PUC** | Mark PUC, multiple PUCs | `estab_file_puc` multiple active PUCs, mark/unmark | — | — | 90% |
| **Referencing** | Refer PUC, FR/SR/GFR, precedents, cross-file, annexures | Page ranges + PUC link; notes free-text | No structured rule/precedent/cross-file reference objects | Medium | 50% |
| **Drafting (DFA)** | Draft from file, versioning, comments, approved→final | DFA state machine draft→pending→approved→returned→signed→dispatched; editable while draft/returned; maker-checker | **No draft versioning**; DFA number uses `Math.random()` (not gapless); no template library | **High** | 65% |
| **Approval** | Configurable authority, dissent/partial/conditional | `approval-rules` module; maker-checker; note + DFA approval | Conditional/partial approval not explicit | Low | 85% |
| **Issue** | Approved draft → final issue copy, eSign | `signed` state gates dispatch; eSign mandatory gate per tenant | — | — | 85% |
| **Dispatch** | Dispatch no., mode, delivery proof, auto-add to correspondence | `estab_dispatch`: gapless `DSP/<year>/<6-digit>`, mode, enclosures, delivery status/proof | Auto-link issued copy → correspondence not evidenced | Low | 90% |
| **File movement** | Hierarchy routing, return/recall/park/transfer, pendency tracking | `estab_file_movements` from/to/action/remarks; recall + reopen verbs; operator eligibility + clearance gate; closed-file guard | No park/call-up; no parallel marking; pendency dashboard partial | Medium | 80% |
| **File closure** | Close only after disposal classification | `fileClose` rejects if no record category assigned (disposal-gated); audited | — | — | 90% |
| **Record room** | Physical location, transfer to record room, issue/receipt register | `estab_file_record` (category/retention/review-due/disposal) | No physical location/rack; no record-room issue/receipt register | Medium | 50% |
| **Retention** | RRS category + retention period + review date | `RECORD_CATEGORIES` A–E, `RETENTION_YEARS` (A=permanent), `review_due_date` | Category naming may need RRS alignment | Low | 85% |
| **Archival** | Distinct archival; Cat-A → NAI after 25y | `status='archived'` enum value only | No archival workflow, no NAI transfer, no archival register | Medium | 40% |
| **Weeding** | Propose→approve(maker≠checker)→destroy + cert | `estab_weedout` propose→approve→destroy; maker≠checker; `destruction_cert_ref` | — | — | 90% |
| **Public Records compliance** | Records Officer, annual review, NAI transfer, no unauthorised destruction | Retention + weed-out + destruction cert + audit | No Records Officer role; no annual review register; no NAI transfer | Medium | 60% |
| **CSMOP compliance** | End-to-end CSMOP procedure | Strong across noting/correspondence/dispatch/movement | Edges above | Low | 85% |
| **NIC eOffice parity** | eFile, eReceipt, notings, draft, dispatch, DSC/eSign, KMS, collaboration | eFile/notings/correspondence/DFA/dispatch/movement/eSign present | No draft template library, file cover page, VIP/Parliament refs, KMS/collaboration (Spark) | Medium | 65% |

---

## 3. Missing Government Processes (consolidated)

1. **Organisation hierarchy entity** — Ministry/Dept/Wing/Division/Section as first-class, hierarchy-driven file routing & marking lists. *(High)*
2. **File-type taxonomy** — part files, volumes (auto Vol II when a file exceeds page limit), linked files, standing guard files, ephemeral/"p" files. *(High)*
3. **DFA draft versioning + gapless DFA numbering + draft template library** (standard OM/letter/sanction templates). *(High)*
4. **Structured referencing** — link a note to FR/SR/GFR rule, precedent file, financial concurrence, legal opinion, annexure, as typed references that stay stable. *(Medium)*
5. **Record-room management** — physical location (rack/shelf), transfer-to-record-room, issue/receipt register, requisition of a recorded file. *(Medium)*
6. **Archival & NAI transfer workflow** — distinct from closure; 25-year Cat-A transfer to National Archives; archival register. *(Medium)*
7. **Records Officer role + annual records review register** (Public Records Rules). *(Medium)*
8. **NIC eOffice parity features** — file cover page, VIP/Parliament-question references, migration of physical-to-eFile mapping (partial today), collaboration/messaging. *(Medium)*
9. **System diary/DAK numbering** (gapless, like file/dispatch numbers). *(Low)*
10. **Conditional/partial approval** modelling on notings/DFA. *(Low)*

---

## 4. Recommendations & Implementation Roadmap

### Phase 1 — Structural foundations (High; ~3–4 weeks)
- **R1. Org-hierarchy module** (`org`): `estab_org_unit` (ministry/dept/wing/division/section, parent_id, type, code) + map operators/files to org units. Enables hierarchy-driven marking lists. → closes Gap #1.
- **R2. File-type taxonomy**: add `file_type` (`main|part|volume|linked|standing_guard|ephemeral`) + `volume_no` + `linked_file_ids` to `estab_files`; auto-open Vol II on page threshold. → closes Gap #2.
- **R3. DFA hardening**: gapless DFA numbering via `estab_doc_seq` (replace `Math.random()`); `estab_dfa_version` (draft revisions with diff/comments); draft template library (`estab_dfa_template`). → closes Gap #3.

### Phase 2 — Records lifecycle completion (Medium; ~3 weeks)
- **R4. Record-room module**: physical location fields + issue/receipt requisition register + state `transferred_to_record_room`.
- **R5. Archival workflow**: explicit `archive` verb distinct from `close`; Cat-A NAI-transfer task at 25y; archival register + report.
- **R6. Records Officer role** + annual review register (list files due for review by `review_due_date`).

### Phase 3 — Referencing & eOffice parity (Medium; ~3 weeks)
- **R7. Structured referencing**: `estab_reference` (note_id → {type: rule|precedent|file|annexure|concurrence, ref}). Stable, searchable.
- **R8. eOffice parity**: file cover page generation, VIP/Parliament-question reference fields, issued-copy auto-link into correspondence, draft template library (shared with R3).

### Phase 4 — Polish (Low; ~1 week)
- **R9. System diary numbering** (gapless DAK no.), duplicate-subject warning on file open.
- **R10. Conditional/partial approval** flags on noting/DFA + UI.

**Projected compliance after Phase 1–2: ~88%; after Phase 3: ~94%; after Phase 4: ~96% (World-class / full NIC eOffice parity for the establishment domain).**

---

## 5. What is already world-class (do not regress)
Immutable hash-chained notings; gapless file & dispatch numbering; disposal-gated closure; maker-checker on sanction/inquiry/weed-out; classification-based access control with audited denials + top-secret break-glass; per-tenant eSign (mock + C-DAC + eMudhra) with mandatory-dispatch gate; full-text file search; correspondence page-range stability + PUC. These meet or exceed CSMOP/eOffice expectations and are covered by 70 passing tests.
