# Gap-Closure Task List — HRMS/ATS Verification Remediation

**Generated:** 2026-07-28
**Source:** audit-results/FINAL-VERIFICATION-SUMMARY.md
**Total tasks:** 40 (across 8 sprints)

---

## Per-Task Workflow (MANDATORY for every task)

Every task below MUST follow this exact loop. Do not skip the verify gate.

```
1. VERIFY-FIRST
   - Re-inspect source + DB + live API for the specific checklist ID(s).
   - Determine actual state: ALREADY-DONE | PARTIAL | MISSING.
   - If ALREADY-DONE → write a verification test proving it, mark task
     "Verified - Pass", commit the test only, close task. NO feature code.
   - If PARTIAL or MISSING → proceed to step 2.

2. BRANCH
   - git checkout main && git pull
   - git checkout -b fix/<task-id>-<slug>

3. IMPLEMENT
   - Follow steering rules (bigint paise, zod at boundary, CQRS,
     RLS, no `any`, migrations additive+idempotent with lock_timeout).
   - Business code goes in services/<svc>/src/**; migrations in
     services/<svc>/migrations/.

4. BUILD
   - pnpm --filter @civitasone/<svc> build   (must pass, zero TS errors)

5. TEST
   - Unit/integration test co-located in services/<svc>/tests/.
   - Verification test in tests/verification/ proving the checklist item.
   - pnpm --filter @civitasone/<svc> exec vitest run --coverage
     (>=80% lines for touched service — HARD RULE)

6. PR
   - git push -u origin <branch>
   - gh pr create with: what changed, checklist IDs closed, how tested,
     migration steps. Post an adversarial self-review comment.

7. MERGE
   - gh pr merge <n> --merge --admin --delete-branch
   - git checkout main && git pull

8. NEXT
   - Update this file's status column. Move to the next task.
```

**Stop conditions:** If build or tests fail twice, diagnose root cause and
report before continuing. Never merge with red CI or coverage < 80%.

---

## SPRINT 1 — Medium-Severity Defects (9 tasks)

| Task | ID | Checklist | Verify Target | Service | Status |
|------|-----|-----------|---------------|---------|--------|
| T01 | DEF-LM-002 | T&A-LM-0283 | Is there date-overlap detection on leave apply? | hrms | ✅ Merged (PR #248) |
| T02 | DEF-AT-001 | T&A-ATM-0247 | Is attendance locked after payroll cut-off? | hrms | ✅ Merged (PR #251) — lock table, GET/POST locks + unlock, 422 ATTENDANCE_LOCKED, idempotent consumer, OpenAPI + DB-schema docs |
| T03 | DEF-RC-003 | R-RA-0077 | Is there OTP verification on public apply? | hrms | ☐ |
| T04 | DEF-EM-003 | CH-EMDS-0199 | Is there a nominee/dependant table? | hrms | ☐ |
| T05 | DEF-EM-002 | CH-EMDS-0198 | Is there a multi-address model with history? | hrms | ☐ |
| T06 | DEF-RC-007 | R-RA-0117 | Is there COI detection between panel & candidate? | hrms | ☐ |
| T07 | DEF-RC-002 | R-RA-0073 | Are there candidate job alerts / saved searches? | hrms | ☐ |
| T08 | DEF-LM-001 | T&A-LM-0291 | Is there a leave-type conversion endpoint? | hrms | ☐ |
| T09 | DEF-EM-004 | CH-EMDS-0224 | Is the attestation lock enforced on service-book? | hrms | ☐ |

### Task detail — T01 (template for all)
- **Verify:** `grep` leave routes/consumer for overlap check against
  pending/approved apps on same employee + date range.
- **If missing, implement:** in `services/hrms-service/src/modules/leave/routes.ts`
  `enforceCcsLeaveRules`, add a query for overlapping apps → throw 422
  `LEAVE_OVERLAP`.
- **Test:** create two overlapping applications; second must be rejected 422.
- **Branch:** `fix/def-lm-002-leave-overlap`

---

## SPRINT 2 — Recruitment & ATS completion drive (R-RA-0048…0167) — ACTIVE

> **Supersedes the original 8-task Sprint 2** (reconciled 2026-07-29 against the
> evidence-based Recruitment handoff). ~87/120 items already merged to main
> (PRs #237–261). Goal: build every **buildable** remaining item to
> merged-and-verified; for genuine **third-party integrations** build the
> internal record/state + typed adapter seam + feature flag + stub adapter and
> mark them **honestly** — do NOT fake integrations to inflate the count.
>
> Rules layered on top of the per-task workflow above:
> - Always work in a `git worktree` under `/home/ec2-user/wt/<name>` and commit
>   to a branch immediately (the suite repo does a `git reset --hard` ~every
>   15 min that wipes uncommitted edits).
> - **Adversarial code-review subagent BEFORE committing** — fix every
>   CRITICAL/HIGH, address MEDIUMs. Hard gate.
> - **Live smoke** against the real API + DB with a real JWT after deploy —
>   the gate that catches schema/driver mismatches mocked tests can't.
> - Next migration number = **0092**. New tables: ENABLE + FORCE RLS +
>   tenant_id GUC policy + GRANT to `hrms_svc`.
> - Platform landmines to respect: postgres-js affected-rows is `.count` not
>   `.rowCount`; jsonb columns are double-encoded (verify via GET, not `->>`);
>   grep `app.ts`/`db.ts` for export-name collisions before adding; run
>   `\d <table>` before writing to existing tables; remove `as never` casts
>   after adding columns.

### 2A — Reconciled from original Sprint 2 (status corrected against handoff DONE list)

| Old task | ID | Item | Status |
|----------|-----|------|--------|
| T12 | R-RA-0083 | References / declarations table | ✅ Merged (reservation attributes + references 0082/0083) |
| T14 | R-RA-0135 | Malpractice / reschedule workflow | ✅ Merged (full Assessment A–D 0120–0136) |
| T17 | R-RA-0162 | Offer-acceptance metadata (IP/device) | ✅ Merged (Selection & offer core 0153–0167) |
| T10 | R-RA-0099 | Application-fee collection | ↪ Re-verify in 2B gap-fill diff, R07 (Application & eligibility 0092–0105) |
| T11 | R-RA-0059 | Requisition clone endpoint | ↪ Re-verify in 2B gap-fill diff, R07 (Job requisition 0048–0062) |
| T13 | R-RA-0105 | Application-PDF download | ✅ Merged (PR #281) — GET /v1/hrms/applications/:id/pdf via @civitasone/render, HTML-escaped, no internal-field leak, honest html-only fallback; live-smoke verified (200 application/pdf) |
| T15 | R-RA-0140 | Interview calendar sync | ➜ Reclassified **EXTERNAL** (see 2B) |
| T16 | R-RA-0143 | Candidate self-reschedule | ➜ Buildable (see 2B, R05) |

### 2B — BUILDABLE (build to merged-and-verified)

| Task | ID | Requirement | Notes | Status |
|------|-----|-------------|-------|--------|
| R01 | R-RA-0087 | Multiple resume versions + active-resume flag | version rows + single active per candidate | ✅ Merged (PR #263 + fix #264) — migration 0092, upload/list/activate, DB single-active invariant, IDOR key guard; live-smoke verified |
| R02 | R-RA-0111 | HR override of automated screening | maker-checker: approver ≠ overrider; reason + audit | ✅ Merged (PR #266) — request/approve/reject/cancel, SoD (≠ requester & ≠ author), ABA-proof version pin, closed the single-admin direct-override bypass, fixed inert .rowCount guard (C1); live-smoke verified |
| R03 | R-RA-0118 | Rejection comms without disclosing internal scoring | policy flag + candidate-facing projection strips scores | ✅ Merged (PR #268) — allow-list candidate notice, per-vacancy disclose flag (fail-closed, migration 0094); live-smoke verified no score/remark/screener leak |
| R04 | R-RA-0142 | Interview invite/reminder/reschedule/cancel comms lifecycle | send via outbox/stub behind a flag | ✅ Merged (PR #271 + fix #272) — comms log (migration 0095), outbox/stub behind FEATURE_INTERVIEW_COMMS_ENABLED, idempotency key on dispatch, real date/time validation, state guard; live-smoke verified |
| R05 | R-RA-0143 | Candidate self-service confirm / request reschedule | request record + HR approve/decline (note auth deferral) | ✅ Merged (PR #274) — confirm/reschedule_request + HR approve/decline (migration 0096), future-slot validation, one-pending-per-interview, HR-gated auth-deferral stand-in; live-smoke verified |
| R06 | R-RA-0152 | Recording/transcript with consent + retention controls | consent + retention_until + delete-after; storage behind a seam | ✅ Merged (PR #276 + fix #277) — consent (fail-closed at server + DB) + consentReference, retention_until + expired-purge query, soft-delete erasure with honest object-purge stub, path-traversal-safe key (migration 0097); live-smoke verified |
| R07 | 0048–0062 / 0063–0076 / 0092–0105 | Gap-fills found by diffing existing modules vs checklist | includes re-verifying old T10/T11/T13 | ✅ Merged (PR #279) — verify-first: T11 R-RA-0059 clone already done+tested; built T10 R-RA-0099 application fee (assess/exempt/manual-pay, migration 0098, verified-exemption anti-bypass, online gateway deferred as honest 501); live-smoke verified. T13 R-RA-0105 application PDF remains (needs @civitasone/render) |

### 2C — EXTERNAL (internal skeleton + typed adapter seam + feature flag + stub adapter + honest note — DO NOT fake)

| Task | ID | Integration | Status |
|------|-----|-------------|--------|
| X01 | R-RA-0078 / 0079 | DigiLocker / LinkedIn login | ✅ Already in identity-service (gov-integrations + OAuth modules); verified by baseline |
| X02 | R-RA-0088 / 0107 / 0145 | AI resume parse / JD-match / AI question generation | ✅ Seam merged (PR #284) — RecruitmentAiAdapter + feature flag + honest 501/stub |
| X03 | R-RA-0128 | Remote proctoring | ✅ Seam merged (PR #284) — ProctoringAdapter + feature flag + honest 501/stub |
| X04 | R-RA-0140 / 0141 | Calendar sync + Teams/Zoom meeting links | ✅ Merged (PR #283) — real .ics + CalendarAdapter seam (honest 501 for push-sync) |
| X05 | R-RA-0151 / 0159 | eSign | ✅ Seam merged (PR #284) — ESignAdapter + feature flag + honest 501/stub; @civitasone/render DSC exists |
| X06 | R-RA-0154 | eOffice | ✅ Already Verified-Pass (eoffice-consumer.ts + CONSUMED_EVENTS.recruitmentFileDecided) |
| X07 | R-RA-0166 | Accepted → pre-joining handoff | ✅ Already Verified-Pass (hire endpoint → employee creation via CQRS) |

> **Honesty gate:** external items must never return fabricated verdicts. If a
> provider/model is not wired, the endpoint returns 501 or `{ source: "stub" }`,
> never a fake pass. Report the final **buildable-vs-external split plainly** —
> do not claim literal 120/120 unless the third-party services are actually
> integrated and verified.

---

## SPRINT 3 — Onboarding + Structured Data (7 tasks)

| Task | ID | Checklist | Verify Target | Service | Status |
|------|-----|-----------|---------------|---------|--------|
| T18 | — | HTR-PO-0173 | Is there BGV component tracking? | hrms | ☐ |
| T19 | — | HTR-PO-0192 | Is there 30/60/90-day onboarding task tracking? | hrms | ☐ |
| T20 | — | HTR-PO-0191 | Is buddy/mentor assignment supported? | hrms | ☐ |
| T21 | — | HTR-PO-0169 | Is mandatory-doc config per employee-type? | hrms | ☐ |
| T22 | DEF-EM-001 | CH-EMDS-0222 | Is there property-return filing tracking? | hrms | ☐ |
| T23 | — | R-RA-0084/0085 | Are education & employment history structured? | hrms | ☐ |
| T24 | — | HTR-PO-0190 | Are policy acknowledgements tracked? | hrms | ☐ |

---

## SPRINT 4 — POSH / ICC Case Management (5 tasks)

| Task | ID | Checklist | Verify Target | Service | Status |
|------|-----|-----------|---------------|---------|--------|
| T25 | — | ER-GPDV-0561..0567 | Does ICC complaint intake exist (confidential)? | hrms | ☐ |
| T26 | — | ER-GPDV-0568..0570 | Is there ICC hearing + finding workflow? | hrms | ☐ |
| T27 | — | ER-GPDV-0571..0573 | Statutory 90-day timeline tracking + escalation? | hrms | ☐ |
| T28 | — | ER-GPDV-0563..0566 | Is complaint access restricted to ICC members? | hrms | ☐ |
| T29 | — | ER-GPDV-0579/0583 | Annual POSH report generation? | hrms | ☐ |

---

## SPRINT 5 — Performance & APAR Completion (5 tasks)

| Task | ID | Checklist | Verify Target | Service | Status |
|------|-----|-----------|---------------|---------|--------|
| T30 | — | P&T-PKA-0394/0399 | Is 360-degree feedback wired? | hrms | ☐ |
| T31 | — | P&T-PKA-0396/0397 | Is calibration-committee workflow present? | hrms | ☐ |
| T32 | — | P&T-PKA-0400 | Bell-curve/forced distribution analytics? | hrms | ☐ |
| T33 | — | P&T-PKA-0406/0407 | APAR disclosure-to-employee + representation? | hrms | ☐ |
| T34 | — | P&T-PKA-0411/0412 | Rating appeal + PIP linkage? | hrms | ☐ |

---

## SPRINT 6 — AI Module Enablement (4 tasks)

| Task | ID | Checklist | Verify Target | Service | Status |
|------|-----|-----------|---------------|---------|--------|
| T35 | — | A-AHC-0702..0705 | Do AI endpoints return real (non-stub) verdicts? | hrms/ml | ☐ |
| T36 | — | A-AHC-0706..0710 | Is there bias/accuracy/drift monitoring? | hrms/ml | ☐ |
| T37 | — | A-AHC-0711..0714 | Is there a manual-process fallback + opt-out? | hrms/ml | ☐ |
| T38 | — | A-AHC-0715..0717 | Are AI decisions audited + explainable? | hrms/ml | ☐ |

> NOTE: honesty gate — AI tasks must NOT return fabricated verdicts. Reuse the
> quality-program L8 "no-fabricated-verdicts" pattern. If a model is not
> deployed, the endpoint must return 501 or `{source:"stub"}`, never a fake
> pass.

---

## SPRINT 7 — Integration Verification (2 tasks)

| Task | ID | Checklist | Verify Target | Service | Status |
|------|-----|-----------|---------------|---------|--------|
| T39 | — | I-EI-0654..0665 | DigiLocker/eSign/eOffice/bank live-sandbox tests | multi | ☐ |
| T40 | — | I-EI-0666..0675 | PF/ESIC/PFMS file generation + upload ack | payroll | ☐ |

---

## SPRINT 8 — Business Sign-off Items (NOT auto-closable)

Data Migration (I-DMC-0788..0799) and UAT/Go-Live (I-CUG-0800..0811) —
**24 items** — require legacy data access, parallel-run reconciliation and
business-owner sign-off. These cannot be closed by code alone. Track them in a
separate UAT workshop, not in this automated loop.

---

## Progress Tracking

| Sprint | Tasks | Done | Verified-Only | Implemented | Blocked |
|--------|-------|------|---------------|-------------|---------|
| 1 | 9 | 2 | 0 | 2 (T01 #248, T02 #251) | 0 |
| 2 — Recruitment drive | 14 (7 buildable + 7 external) | 1 (R01 #263/#264) | — | ~88/120 module items merged | 0 |
| 3 | 7 | 0 | 0 | 0 | 0 |
| 4 | 5 | 0 | 0 | 0 | 0 |
| 5 | 5 | 0 | 0 | 0 | 0 |
| 6 | 4 | 0 | 0 | 0 | 0 |
| 7 | 2 | 0 | 0 | 0 | 0 |
| 8 | 24 | 0 | — | — | 24 (business) |

Update after each merge.

### Sprint 2 recruitment drive — status: all BUILDABLE (2B) items done ✅

All seven 2B buildable tasks are merged, deployed to civitas_hrms, and
live-smoke verified:
- R01 R-RA-0087 resume versions (PR #263/#264)
- R02 R-RA-0111 maker-checker screening override (PR #266)
- R03 R-RA-0118 rejection notice without internal scoring (PR #268)
- R04 R-RA-0142 interview comms lifecycle (PR #271/#272)
- R05 R-RA-0143 candidate confirm/request-reschedule (PR #274)
- R06 R-RA-0152 recording/transcript consent+retention (PR #276/#277)
- R07 R-RA-0099 application fee + verified R-RA-0059 clone (PR #279)

Remaining in the drive:
- **R-RA-0105** (application PDF download) — ✅ done (PR #281), rendered via
  `@civitasone/render`.
- **2C EXTERNAL (X01–X07)** — DigiLocker/LinkedIn, AI parse/JD-match/questions,
  proctoring, calendar/Teams-Zoom, eSign, eOffice, pre-joining handoff. Each
  needs an internal skeleton + typed adapter seam + feature flag + stub +
  honest note (501/`{source:"stub"}`), NOT a faked integration.

Module-wide follow-ups surfaced by adversarial reviews (track separately):
CQRS/outbox audit on the candidate/recruitment direct-write routes; the inert
`.rowCount` optimistic-lock checks in sibling recruitment repos (C1); the
`0083` migration-number collision.

Standing kick-off checklist for each task:
1. Branch from fresh `origin/main`; build the module (schema/domain/repo/routes),
   register in app.ts + db.ts.
2. Domain + route tests → adversarial review (fix CRITICAL/HIGH) → full suite
   green → PR → squash-merge → deploy (migrate + rebuild dist + pm2 restart) →
   **live smoke** → update memory + this file.

> ⚠️ Migration-numbering note: the merged attendance-lock migration
> `0083_attendance_period_lock.sql` collides with the existing
> `0083_assessment_result.sql` (duplicate sequence 0083). It is inert for
> recruitment work (next recruitment migration is 0092), but should be
> renumbered/renamed in a follow-up housekeeping PR to keep the sequence unique.
