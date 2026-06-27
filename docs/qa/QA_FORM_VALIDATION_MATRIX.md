# CivitasOne — Form Validation Matrix

Legend: ✓ = meets bar · ◐ = partial / minor gap · ✗ = fails
Columns map to the audit rubric. **Verdict** is the overall pass/fail for the form.

| Form | Module | Required✓ | Format✓ | Boundary✓ | A11y✓ | Network-fail✓ | FE/BE consistent✓ | Verdict |
|---|---|:--:|:--:|:--:|:--:|:--:|:--:|---|
| RegisterVendorForm | Procurement (Vendor) | ✓ | ✓ | ✓ | ✓ | ◐ | ✓ | **PASS** (reference) |
| JournalEntryForm | Finance | ✓ | ✓ | ✓ | ✓ | ✓ | ◐ | **PASS** (reference) |
| ApplyLeaveForm | HR (Leave) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | **PASS** (reference) |
| CreatePayrollRunForm | Payroll | ✓ | ✓ | ◐ | ✓ | ✓ | ✓ | **PASS** (strong) |
| CreatePensionerForm | Payroll | ✓ | ✓ | ◐ | ◐ | ◐ | ✓ | **PASS** |
| CreateIndentForm | Procurement | ✓ | ◐ | ◐ | ◐ | ◐ | ✓ | **PASS** |
| CreatePOForm | Procurement | ✓ | ◐ | ◐ | ◐ | ◐ | ✓ | **PASS** |
| CreateRFQForm | Procurement | ✓ | ◐ | ✗ | ◐ | ◐ | ✓ | **PASS** (date gap) |
| CreateGRNForm | Procurement | ✓ | ◐ | ◐ | ✓ | ◐ | ✓ | **PASS** |
| CreateTenderForm | Procurement | ✓ | ✓ | ✗ | ◐ | ◐ | ✓ | **PASS** (date gap) |
| CreateContractForm | Procurement (Contract) | ✓ | ◐ | ✗ | ◐ | ◐ | ✓ | **PASS** (date gap) |
| CreateCaseForm | Legal | ✓ | ◐ | ◐ | ◐ | ◐ | ✓ | **PASS** |
| RecordOrderForm | Legal | ✓ | ◐ | ◐ | ✓ | ✓ | ✓ | **PASS** |
| SeekOpinionForm | Legal | ✓ | ◐ | ◐ | ✓ | ✓ | ◐ | **PASS** (mapped endpoint) |
| NewTrainingForm | HR (Training) | ✓ | ✓ | ✓ | ◐ | ◐ | ✓ | **PASS** |
| NewAppraisalForm | HR (Appraisal) | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | **PASS** (minor) |
| CreateDocumentForm | Knowledge | ✓ | — | ◐ | ◐ | ◐ | ✓ | **PASS** |
| CreateReportForm | Reports | ✓ | — | ◐ | ◐ | ◐ | ✓ | **PASS** |
| RunQueryForm | Analytics | ✓ | ◐ | ✓ | ✓ | ◐ | ✓ | **PASS** (strong) |
| EditContactForm | CRM | ✓ | ◐ | ◐ | ◐ | ✓ | ✓ | **PASS** (minor) |
| CreateSchemeForm | Grants | ✓ | ◐ | ◐ | ◐ | ◐ | ◐ | **PASS** (dropped fields) |
| EditEmployeeForm | HR (Employee) | ◐ | ◐ | ◐ | ◐ | ✓ | ✗ | **FAIL** (FV-007, High) |
| NewJobOpeningForm | HR (Recruitment) | ◐ | ✗ | ◐ | ◐ | ◐ | ✗ | **FAIL** (FV-005, High) |
| TaxDeclarationForm | Payroll | ◐ | ◐ | ◐ | ◐ | ◐ | ✗ | **FAIL** (FV-006, High — no server zod) |
| NewTicketForm | Helpdesk | ✓ | ◐ | ◐ | ◐ | ◐ | ✗ | **FAIL** (FV-004, High — priority casing) |
| CreateProjectForm | Projects | ◐ | ◐ | ✓ | ◐ | ◐ | ✗ | **FAIL** (FV-001, Critical) |
| NewPlanForm | Billing | ◐ | ◐ | ◐ | ◐ | ◐ | ✗ | **FAIL** (FV-002, Critical) |
| NewContractForm | Contracts (generic) | ◐ | ◐ | ✓ | ◐ | ◐ | ✗ | **FAIL** (FV-003, Critical) |

**Totals:** 21 PASS · 7 FAIL (3 Critical, 4 High) · 28 forms.

**Shared primitives (not forms, audited):**

| Component | Purpose | Verdict |
|---|---|---|
| `ConfirmDialog` (`_components/ds`) | Maker-checker modal | ✓ Exemplary (role=alertdialog, focus-trap, Esc, focus restore, aria-live) |
| `fetchOrQueue` (`lib/sync/requestQueue.ts`) | Offline outbox | ✓ Strong (IndexedDB, idempotency key, 4xx surfaced, 5xx/offline queued) — but adopted by only 1 form |
