# CivitasOne (gov-ERP) — Form Validation Quality Audit

**Scope:** 28 form components under `apps/web/src/app/(app)/**/*Form.tsx` plus the shared
action/confirm dialog (`ConfirmDialog`) and the offline outbox (`fetchOrQueue`).
**Method:** Each form's client source was read alongside the backend `validators.ts`
(zod) parsed by the POST/PATCH endpoint it targets. Findings are evidence-based; file
paths and schema lines are cited.
**Rubric:** Adapted from `.claude/prompts/10-form-validation-audit.md` and skills
`10-form-and-input-validation.md` + `08-accessibility-wcag-22.md`.

---

## 1. Executive Summary

CivitasOne's form layer is **bimodal**. A cohort of reference forms — the procurement
**vendor** registration, the finance **journal-entry**, and the HR **apply-leave** form —
are genuinely world-class: shared per-field validators, `aria-invalid` /
`aria-describedby` wiring, `role="alert"` field errors, 44px targets, maker-checker
confirm dialogs (`role="alertdialog"`, focus-trap, `Esc`, focus restore), and a durable
offline replay queue with idempotency keys. The shared `ConfirmDialog` and `fetchOrQueue`
primitives are excellent and production-grade.

However, the audit found **three forms that cannot succeed against their backend at all**
because the client payload does not match the zod schema the endpoint parses (projects,
billing plans, generic contracts), **four further high-severity defects** (helpdesk ticket
priority casing, recruitment job-opening required/UUID fields, the tax-declaration
endpoint having no server-side schema, and the employee-edit form silently dropping two
fields), and a set of medium issues around date-range logic, dropped fields, raw-JSON
error display, and uneven adoption of the offline queue and accessible field-error
patterns outside the three reference forms.

**Net result:** strong foundations, but the create-flow regressions and the one
unvalidated endpoint are release-blocking.

**Form-validation quality score: 68 / 100 — NO-GO** until the Critical/High defects
(FV-001…FV-007) are resolved. Procurement, Finance, and Leave modules are individually
GO-ready today.

| Severity | Count |
|---|---|
| Critical | 3 |
| High | 4 |
| Medium | 6 |
| Low | 4 |

**Forms passing:** 21 / 28 · **Forms failing:** 7 / 28

---

## 2. Per-Module Findings

### Auth / Identity
No `*Form.tsx` exists under the app shell for auth — sign-in is handled outside the audited
form set. **Gap noted:** the audit could not assess login/MFA field validation here; it
should be covered separately (identity-service `users`/`sessions` validators exist).

### HR (leave / employee / appraisal / recruitment / training)
- **ApplyLeaveForm** — *Reference quality.* Client checks employee/type/from/to, computes
  duration, blocks `to < from`, and blocks over-balance before submit. Payload
  (`employeeId`,`leaveTypeId`,`allocId`,`fromDate`,`toDate`,`daysApplied`,`reason`) matches
  `hrms-service/.../leave/validators.ts` `applyLeaveBody` exactly (UUIDs, date regex,
  positive int). Uses `fetchOrQueue` → offline durable. `role`/`aria-live` correct. **PASS.**
- **NewAppraisalForm** — Consistent (`employeeId` UUID, `appraisalPeriod`). Minor: backend
  `appraisalPeriod` is `min(4).max(16)` (appraisals/routes.ts:31) but the client only checks
  non-empty, so `"Q1"` passes the client and 400s the server (FV-014). **PASS (minor).**
- **EditEmployeeForm** — **FV-007 (High).** PATCHes `phone` and `reportingTo`, but
  `employee/validators.ts` `updateEmployeeBody` accepts `mobile` and `managerId`. zod strips
  the unknown keys, so editing a phone number or manager **silently does nothing** (only
  `email`/`payStructureId` persist). **FAIL.**
- **NewJobOpeningForm (recruitment)** — **FV-005 (High).** `recruitment/validators.ts`
  `createJobOpeningBody` requires `refNo` (min 1) and `departmentId` as a **UUID**, and uses
  `closesAt`. The form sends no `refNo`, a free-text `departmentId` (`"DEPT-ENG-01"`), and
  `closingDate`. Result: every submit 400s. **FAIL.**
- **NewTrainingForm** — Strong: requires title/from/to, blocks `to < from`, `maxParticipants ≥ 1`.
  Matches `training/validators.ts` (date regex, positive default 30). **PASS.**

### Payroll (run / pensioner / tax)
- **CreatePayrollRunForm** — *Strong.* Client-side duplicate-period guard with a visible
  `role="alert"` warning, maker-checker `ConfirmDialog`, `aria-invalid` on the month field.
  Matches `payroll/validators.ts` `createRunBody` (`runNo`, `month` `YYYY-MM`, `structureId`).
  **PASS.**
- **CreatePensionerForm** — Required PPO/name/DOB, PAN regex client + server. Matches
  `createPensionerBody`. Minor: no `commutationDate ≥ dateOfBirth` / future-DOB check (FV-010).
  **PASS.**
- **TaxDeclarationForm** — **FV-006 (High).** The endpoint `POST /v1/payroll/tax-declarations`
  (`payroll-service/.../tax/routes.ts:175`) **does not zod-parse** the body — it `req.body as {…}`
  casts and only checks `fy` presence. The amount fields (`section80c`, `rentPaidMinor`, …) are
  not validated as non-negative integers, so a bypassed UI can submit negative/huge/non-numeric
  values. Violates the "backend never trusts the frontend" rule. **FAIL (server gap).**

### Finance (journal)
- **JournalEntryForm** — *Reference quality.* Per-field errors, debit/credit balance check
  mirrors the backend `postJournalBody.refine(...)` (`gl/validators.ts`: `lines.min(2)` + balance),
  maker-checker confirm with required reason. **FV-008 (Medium):** the client collects a
  **required** `narration` (and a maker-checker `reason`) but `postJournalBody` has no
  `narration`/`reason` field — both are dropped server-side, so the audit trail/description the
  user typed is not persisted via this schema. **PASS (with data-loss note).**

### Procurement (vendor / indent / PO / RFQ / GRN / tender / contract)
- **RegisterVendorForm** — *Reference quality.* Shared validators for GSTIN/PAN/IFSC/email/phone,
  `aria-invalid`+`aria-describedby`, on-blur validation, 44px targets. Matches `vendor/validators.ts`.
  **FV-013 (Low):** client GSTIN regex 12th-char class `[1-9A-Z]` differs from backend `[0-9A-Z]`
  — a vendor whose entity code is `0` is rejected client-side but valid server-side. **PASS.**
- **CreateIndentForm** — Matches `indent/validators.ts` (`purpose` min 3, items min 1, quantity
  positive). FV-015: `indentNo` generated client-side with `Math.random()` → collision/409 risk,
  and a 409 is surfaced as raw text. **PASS.**
- **CreatePOForm / CreateRFQForm / CreateGRNForm** — Consistent with their endpoints; GRN table
  uses proper `<th scope>` and per-row `sr-only` labels (good a11y). RFQ requires ≥1 invited vendor.
  **PASS.** Boundary gap: RFQ `closingDate` / tender `bidClosingDate` are not validated as future
  dates (FV-010).
- **CreateTenderForm** — Money fields show a live formatted preview; required title + closing date.
  **PASS.**
- **CreateContractForm (procurement)** — Matches `contract-service` `createContractBody`
  (`contractNo`, `vendorId` UUID, `valueMinor` positive, `startDate`, `expiry`). **FV-010 (Medium):**
  no client check that `expiry ≥ startDate`. **PASS.**

### Legal (case / order / opinion)
- **CreateCaseForm** — Matches `cases/validators.ts` `createCaseBody`. **PASS.**
- **RecordOrderForm** — Uses `useConfirmAction` + `ConfirmDialog` (maker-checker, irreversible action).
  `maxLength` on summary/direction. **PASS.**
- **SeekOpinionForm** — Documented design choice: posts to `legal/notices` (no opinions-create endpoint).
  Confirm-gated. FE/BE consistent for the notices schema. **PASS (documented mapping).**

### Projects
- **CreateProjectForm** — **FV-001 (Critical).** `project/validators.ts` `createProjectBody`
  **requires `code`** and uses `endDate`, `dprCostMinor`/`sanctionedMinor`. The form sends optional
  `projectCode` (wrong key), `expectedEndDate` (wrong key), and `totalBudget` (no such field). When
  the user leaves project code blank — which the form permits — the server 400s on missing `code`;
  even when filled, the budget and end-date are silently dropped. **FAIL.**

### Grants
- **CreateSchemeForm** — **FV-009 (Medium).** `scheme/validators.ts` has no `sector` or `description`
  field, so both are dropped. Backend `name` is `min(3)`; the client only checks non-empty (a 1–2 char
  name passes client, 400s server). Core money fields match. **PASS (with dropped-field note).**

### Billing
- **NewPlanForm** — **FV-002 (Critical).** `plans/validators.ts` `createPlanBody` requires `code`
  (regex `^[a-z0-9_-]+$/i`) and `priceMinor` (int). The form sends `amount` (decimal), `interval`,
  `currency`, `description` and **no `code`/`priceMinor`** → backend 400s on every submit
  (`code` + `priceMinor` required). Endpoint also `requireSuperAdmin`. **FAIL.**

### Reports / Knowledge / Analytics
- **CreateReportForm** — Matches `report-service` `createJobBody`. **PASS.**
- **CreateDocumentForm** — Matches `knowledge-service` `createDocumentBody`. **PASS.**
- **RunQueryForm** — *Strong.* Loads catalog, `.strict()` backend `runQueryBody` matched exactly,
  dimension max-3 enforced, limit clamped 1–1000, date `min`/`max` cross-bound, success banner
  receives focus. **PASS.**

### CRM
- **EditContactForm** — Matches `contacts/validators.ts` `updateContactBody` (`company`,`leadStatus`,
  `marketingConsent`). Minor: phone has no client validation (backend `min(3)`). Separate success
  (`role=status`) and error (`role=alert`) banners. **PASS.**

### Helpdesk
- **NewTicketForm** — **FV-004 (High).** `tickets/validators.ts` `createTicketBody.priority` is
  `enum(["Low","Medium","High","Critical"])` (capitalized) but the form always sends lowercase
  (`"low"|"medium"|"high"`) → zod 400s on priority for every submit. The form's `category` field has
  no backend equivalent (dropped). **FAIL.**

### Contracts (generic)
- **NewContractForm** (`/contracts/new`) — **FV-003 (Critical).** Posts to the same
  `contract-service` `createContractBody` as the procurement contract form, but sends `partyName`,
  `value`, `endDate`, `contractType`, `description` and **none of** the required `contractNo`,
  `vendorId` (UUID), `valueMinor`, `expiry`. Backend 400s on every submit. (The procurement
  CreateContractForm targeting the same schema is correct — this generic one is the broken twin.)
  **FAIL.**

### Tenant-Admin
No `*Form.tsx` in the audited set; tenant-admin screens in the open editors are tables/pages, not
create forms. Not scored.

---

## 3. Defects List

| ID | Module | File | Severity | Validation gap | Recommended fix |
|---|---|---|---|---|---|
| FV-001 | Projects | `projects/new/CreateProjectForm.tsx` | **Critical** | Sends `projectCode`/`expectedEndDate`/`totalBudget`; backend requires `code` and uses `endDate`,`dprCostMinor`/`sanctionedMinor`. Form cannot create a project; budget & end-date dropped. | Rename to `code` (make required client-side), `endDate`; map budget to `sanctionedMinor`/`dprCostMinor` (minor units). Share the zod schema. |
| FV-002 | Billing | `billing/plans/new/NewPlanForm.tsx` | **Critical** | Sends `amount`/`interval`; backend requires `code` (regex) + `priceMinor` (int). Every submit 400s. | Add `code` field (validated to `^[a-z0-9_-]+$`); send `priceMinor = round(amount*100)`; drop/relocate `interval` until backend supports it. |
| FV-003 | Contracts | `contracts/new/NewContractForm.tsx` | **Critical** | Sends `partyName`/`value`/`endDate`; backend requires `contractNo`,`vendorId` (UUID),`valueMinor`,`expiry`. Every submit 400s. | Reuse the working procurement `CreateContractForm` payload (vendor select, `contractNo`, `valueMinor`, `expiry`), or point this route at it. |
| FV-004 | Helpdesk | `helpdesk/tickets/new/NewTicketForm.tsx` | **High** | `priority` sent lowercase; backend enum is `Low/Medium/High/Critical`. Every submit 400s. `category` dropped. | Send capitalized enum values (or map in proxy); add `Critical` option; remove or wire `category`. |
| FV-005 | HR/Recruitment | `hr/recruitment/new/NewJobOpeningForm.tsx` | **High** | No `refNo` (required); `departmentId` free-text not UUID; uses `closingDate` not `closesAt`. Every submit 400s. | Add `refNo`; make department a UUID picker; rename `closingDate`→`closesAt`. |
| FV-006 | Payroll | `payroll-service/.../tax/routes.ts:175` (form `TaxDeclarationForm.tsx`) | **High** | Endpoint casts `req.body as {…}` — **no zod**; amounts not range/type-checked server-side. | Add `tax/validators.ts` zod schema (non-negative int paise, `fy` regex, regime enum) and `.parse()` at the route boundary. |
| FV-007 | HR | `hr/employees/[id]/EditEmployeeForm.tsx` | **High** | PATCH sends `phone`/`reportingTo`; backend accepts `mobile`/`managerId`. Edits silently dropped (data loss). | Rename payload keys to `mobile`/`managerId`; add client email/phone format validation. |
| FV-008 | Finance | `finance/journal-entry/JournalEntryForm.tsx` | **Medium** | Required `narration` and maker-checker `reason` are not in `postJournalBody` → dropped server-side. | Add `narration`/`reason` to `gl/validators.ts` `postJournalBody` and persist. |
| FV-009 | Grants | `grants/schemes/new/CreateSchemeForm.tsx` | **Medium** | `sector` & `description` dropped (not in schema); client `name` allows < 3 chars (backend `min 3`). | Add `sector`/`description` to `scheme/validators.ts`; enforce `name.min(3)` client-side. |
| FV-010 | Procurement / Payroll | RFQ, Tender, procurement Contract, Pensioner forms | **Medium** | Missing date-logic: closing/bid dates not required-future; contract `expiry ≥ startDate` not checked; `commutationDate` vs DOB unchecked. | Add client-side date comparisons + future-date guards; mirror in backend `.refine`. |
| FV-011 | Cross-cutting | all bare-`fetch` forms | **Medium** | Errors shown as raw response text / JSON envelope (e.g. `{"code":"VALIDATION_FAILED"…}`) instead of mapping `fieldErrors[]` to fields. | Parse the standard envelope; map `fieldErrors[].field` to inputs (as vendor/journal forms do for client errors). |
| FV-012 | Cross-cutting | 27 of 28 mutation forms | **Medium** | Only `ApplyLeaveForm` uses `fetchOrQueue`; others use bare `fetch` (no offline durability). | Adopt `fetchOrQueue` for create/patch forms where offline submission is plausible (field/mobile use). |
| FV-013 | Procurement | `procurement/_components/validators.ts` | **Low** | Client GSTIN regex 12th char `[1-9A-Z]` vs backend `[0-9A-Z]` — divergent edge case. | Align the client regex to the backend pattern. |
| FV-014 | HR | `hr/appraisals/new/NewAppraisalForm.tsx` | **Low** | Client doesn't enforce `appraisalPeriod` `min 4` (backend does). | Add a length/format hint and client check. |
| FV-015 | Procurement | Indent/PO/RFQ forms | **Low** | Document numbers generated via `Math.random()` client-side → collision → 409 shown as raw text. | Let the server allocate sequence numbers (as finance does with `"AUTO"`); surface 409 specifically. |
| FV-016 | Cross-cutting | Tailwind HR/billing/contract/pensioner forms | **Low/Med** | Single form-level error region; no per-field `aria-invalid`/`aria-describedby`; inconsistent visible required `*`. | Adopt the reference field-error pattern; add an error summary with focus management. |

---

## 4. Frontend / Backend Consistency Matrix (mismatches)

| Form | Client sends | Backend expects (file) | Verdict |
|---|---|---|---|
| CreateProjectForm | `name, projectCode?, expectedEndDate, totalBudget, department?, scheme?` | `code (req), name, endDate, dprCostMinor/sanctionedMinor, schemeId(uuid)` — `project/validators.ts` | ✗ Breaks |
| NewPlanForm | `name, amount, interval, currency, description?` | `name, code(req,regex), priceMinor(req,int), currency, govtExempt` — `plans/validators.ts` | ✗ Breaks |
| NewContractForm (generic) | `title, partyName, value, endDate, contractType, description?` | `contractNo, vendorId(uuid), title, valueMinor(req), startDate, expiry` — `contracts/validators.ts` | ✗ Breaks |
| NewTicketForm | `priority:"low"…` , `category` | `priority` enum `Low/Medium/High/Critical`; no `category` — `tickets/validators.ts` | ✗ Breaks (priority) |
| NewJobOpeningForm | no `refNo`, `departmentId` text, `closingDate` | `refNo(req)`, `departmentId(uuid)`, `closesAt` — `recruitment/validators.ts` | ✗ Breaks |
| EditEmployeeForm | `phone, reportingTo` | `mobile, managerId` — `employee/validators.ts` | ✗ Silent drop |
| TaxDeclarationForm | numeric amounts | **no zod** (cast) — `tax/routes.ts` | ✗ Server gap |
| JournalEntryForm | `narration(req), reason` | not in `postJournalBody` — `gl/validators.ts` | ◐ Dropped |
| CreateSchemeForm | `sector, description` | not in `createSchemeBody` — `scheme/validators.ts` | ◐ Dropped |
| RegisterVendorForm | GSTIN client regex | backend GSTIN regex (12th char) | ◐ Edge divergence |
| ApplyLeave / Journal / Vendor / Indent / PO / Case / Training / Pensioner / PayrollRun / Document / Report / Query | match | match | ✓ Consistent |

---

## 5. Accessibility Findings (WCAG 2.2 AA)

**Strengths**
- `ConfirmDialog` is exemplary: `role="alertdialog"`, `aria-modal`, `aria-labelledby`/`describedby`,
  focus moved in on open, **Tab/Shift+Tab focus trap**, `Esc` and overlay-click cancel, focus
  **restored to trigger** on close, required-reason field, `aria-live` error region. Used by journal,
  payroll-run, project, court-order, opinion forms.
- Reference forms (vendor, journal, leave, query) associate errors with `aria-invalid` +
  `aria-describedby`, use `role="alert"` for field errors and `role="status"`/`aria-live` for status,
  and meet the 44px touch-target minimum.
- Errors convey meaning by text + `role`, not color alone (passes SC 1.4.1). GRN table uses
  `<th scope>` and per-control `sr-only` labels.
- `RunQueryForm` moves focus to the success banner (good status management) and uses `<fieldset>`/
  `<legend>` for grouped controls.

**Gaps**
- **Per-field error association missing** in the Tailwind-styled forms (appraisal, recruitment,
  training, billing plan, generic contract, pensioner, employee-edit): a single form-level message
  rather than `aria-invalid`/`aria-describedby` per input (FV-016).
- **No error summary with focus** on submit failure in most forms; focus is not moved to the first
  invalid field (errors are announced via `role="alert"`, which is acceptable but not ideal).
- **Inconsistent visible required indicator** — some forms rely on the `required` attribute without a
  visible `*` (e.g. several HR Tailwind forms), while others show `*`.
- Labels are visible and persistent throughout (no placeholder-as-label) — good.

---

## 6. Network-Failure Behaviour

- **Double-submit prevention:** consistent — every form disables the submit button while
  `status === "submitting"`/`busy`. ✓
- **Input preservation on failure:** forms keep state and only reset on success. ✓
- **Status handling:** forms branch on `!res.ok` and show the message; confirm-dialog forms keep the
  dialog open and surface the error inside it. ✓
- **Offline durability:** only `ApplyLeaveForm` uses `fetchOrQueue` (IndexedDB outbox, idempotency
  key, replays on reconnect, queues only on 5xx/transport failure — correctly surfaces 4xx). The other
  27 mutation forms use bare `fetch` (FV-012).
- **Error clarity:** most bare-`fetch` forms display the raw response body — for the JSON envelope this
  renders `{"code":"VALIDATION_FAILED",…}` to the user. `fieldErrors[]` returned by the project route
  are ignored (FV-011).
- **413/429 specific handling:** none observed beyond the generic `(${res.status})` fallback.

---

## 7. Score / 100 — Category Breakdown

| Category | Weight | Score | Notes |
|---|---:|---:|---|
| Required-field validation (client + server) | 15 | 11 | Strong except tax-declaration server gap (FV-006) and forms that never send a required key (FV-001/2/3/5). |
| Format validation (email/PAN/GSTIN/IFSC/date/money) | 12 | 9 | Procurement/finance/pensioner strong; HR Tailwind forms thinner. |
| Boundary / length / date logic | 12 | 7 | Good in leave/training/project/query; gaps in RFQ/tender/contract/pensioner dates (FV-010). |
| Injection / special-char safety | 10 | 9 | zod string caps + parameterized SQL + React escaping; tax endpoint is the exception. |
| Duplicate / conflict (409) clarity | 8 | 4 | Only payroll-run surfaces duplicates well; others show raw text; client-random doc numbers (FV-015). |
| Error-message clarity | 10 | 6 | Raw JSON shown; `fieldErrors` ignored (FV-011). |
| Accessibility (WCAG 2.2 AA) | 15 | 11 | References + ConfirmDialog excellent; Tailwind forms partial (FV-016). |
| Network-failure behaviour | 10 | 7 | Double-submit/preserve solid; offline queue under-adopted (FV-012). |
| Frontend/backend consistency | 8 | 4 | Three breaking forms + several dropped-field/key mismatches. |
| **Total** | **100** | **68** | |

**Form-validation quality score: 68 / 100.**

---

## 8. Sign-offs & GO / NO-GO

**Form-validation readiness: 🔴 NO-GO** (conditional). The foundations, reference forms, and shared
dialog/queue primitives are strong, but three create-flows are non-functional against their backends
(FV-001/002/003), two more high-severity FE/BE breaks exist (FV-004/005), one endpoint has no
server-side validation (FV-006), and one edit-form silently loses data (FV-007). These must be fixed
and regression-tested (including curl-the-endpoint bypass tests) before release.

**Conditional GO** is granted module-by-module for **Procurement**, **Finance (journal)**, and
**HR Leave**, which meet the bar today.

**Required before GO:**
1. Fix FV-001…FV-007 and add backend bypass tests (`curl` with junk payloads) for each affected endpoint.
2. Map `fieldErrors[]` to inputs and stop rendering raw JSON (FV-011).
3. Add Playwright form specs under `tests/e2e/forms/` with mocked 400/409/422/500 + offline.

| Role | Name | Decision | Notes |
|---|---|---|---|
| QA Lead | _________ | **NO-GO** | 7/28 forms fail; 3 create-flows broken. Re-test after FV-001…FV-007. |
| Accessibility Lead | _________ | **Conditional GO** | Reference forms + ConfirmDialog meet AA; close FV-016 (per-field errors, error summary) for full AA across all forms. |
| Security / Validation Lead | _________ | **NO-GO** | FV-006 (no server-side zod on tax-declarations) violates "backend never trusts the frontend"; must add schema + bypass test. |

*Audit performed against the repository as the source of truth; every defect cites the form file and
the backend `validators.ts` (or route) it was checked against.*
