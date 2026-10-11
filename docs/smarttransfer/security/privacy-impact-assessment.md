# SmartTransfer OS — Privacy Impact Assessment (PIA)

> Spec §14 (Security), §19 deliverable 15. DPDP Act 2023 (Digital Personal Data Protection Act) and
> CERT-In directions apply ([`docs/SECURITY.md`](../../SECURITY.md) §7). Companion:
> [`threat-model.md`](threat-model.md). Data inventory sourced from
> [`docs/smarttransfer/er-diagram.md`](../er-diagram.md) and the live schemas it cites.
>
> **Status.** M01 artefact — it RECORDS FACTS (what personal data exists, where, why, who can see
> it, how long it is kept) and flags legal/DPO review as **PENDING**. It is NOT legal advice and
> does NOT itself certify DPDP compliance; the owner must route it to Legal/the Data Protection
> Officer named at kickoff. **Independent review: PENDING** (spec §P09).

## 1. Purpose of processing

SmartTransfer processes employee personal data to run government workforce-movement cycles:
determine eligibility, collect preferences, allocate employees to sanctioned posts under approved
policy, issue signed orders, and reconcile the outcome with HRMS and Payroll. The lawful basis is
the performance of a public function / employment relationship by a State or Ministry (the tenant,
D-ST-04). SmartTransfer is a **processor of movement data** and a **consumer of certified HRMS
records** — it never becomes a second employee master (P02) and never writes HRMS tables (D-ST-10).

## 2. Data inventory — personal fields

Legend for **Sensitivity**: **P** = ordinary personal data; **S** = sensitive (financial, health,
identity-document, or special-category) personal data warranting heightened protection. **At rest**:
`enc` = column-level encrypted (`encryptedText`, `PII_ENC_KEY`); `plain` = stored in clear within the
RLS-isolated tenant DB; `derived`/`by id` = not stored by this component.

### 2.1 Workforce Core (hrms-service, `employee.*` and `workforce_core.*`) — owner of the person

| Field | Table / source | Sens. | At rest | Purpose in SmartTransfer |
|---|---|---|---|---|
| full_name | `hrms_employees` (`employee/schema.ts:45`) | P | plain | Identify the employee on lists, orders, portal |
| date_of_birth | `hrms_employees:50` | P | plain | Retirement/vacancy projection (§8); age-linked eligibility |
| gender | `hrms_employees:51` | P | plain | Reservation roster, category-wise fairness reporting (D-ST-18) |
| pan | `hrms_employees:52` | **S** | **enc** | NOT used by movement; present in the master — kept off events |
| aadhaar_ref | `hrms_employees:56` | **S** | **enc** | Identity for eSign of orders (D-ST-12, PENDING); never on events |
| mobile | `hrms_employees:57` | **S** | **enc** | Notification delivery (via identity lookup, not raw on events) |
| email | `hrms_employees:58` | P | plain | Notification delivery, portal login linkage |
| bank_account_no, bank_ifsc | `hrms_employees:59-60` | **S** | **enc** | NOT used by movement; payroll owns pay (§11.3) |
| disability | `hrms_employees:90` | **S** | plain | Approved hardship/priority consideration (soft objective, §7.1) |
| blood_group | `hrms_employees:102` | **S** | plain | Not used by movement; part of the master |
| home/work address | `hrms_employee_addresses` (`:151`) | P | plain | Spouse/medical/hardship ground evaluation (movement type §5) |
| station, work_state_code, hra_city_class | `hrms_employees` | P | plain | Posting fact on the rich event; HRA class for payroll (D-ST-14) |
| department_id, designation_id, cadre_id | `hrms_employees` / `workforce_core.*` | P | plain | Eligibility, compatibility, cadre-wise seniority |
| posting history (effective-dated) | `workforce_core.posting_ledger` (#1984) | P | plain (append-only) | Tenure/rotation rules; the auditable movement record |
| occupancy | `workforce_core.post_occupancy` (#1984) | P | plain | Who holds which sanctioned post, when |
| employee_hold | `lifecycle.hrms_employee_holds` | **S** | plain | Court stay / vigilance / medical hold (D-ST-16, PROPOSED) — can block a move; reveals legal/health context |

### 2.2 SmartTransfer movement entities (smarttransfer-service, `smarttransfer.*`) — #1979

These reference the person **by opaque id + as-of version only** (no name/Aadhaar/bank duplicated —
P02/D-ST-10). The personal linkage is the `employee_id` foreign reference.

| Field | Table | Sens. | At rest | Purpose |
|---|---|---|---|---|
| employee_id (by id) | `requests`, `preferences`, `assignments`, `orders`, `relieving_records`, `joining_records`, `appeals` | P (pseudonymous ref) | plain | Links a movement record to a person without copying their master data |
| preference ranking | `preferences`, `preference_items` | P | plain | The employee's stated choices (a personal opinion) |
| appeal ground_code | `appeals` | P (may imply S) | plain | Grounds of a representation (may reference medical/spouse) |
| jurisdiction_unit_id | every movement table | — (org, not personal) | plain | Jurisdiction scoping of lists (D-ST-04) |
| order_number, decision evidence | `orders`, `evidence` | P | plain | The authorised outcome and its reproducibility proof (§7.3) |

**No money fields** appear in the M01 movement schema; any added later (payroll reconciliation,
D-ST-13/14, PENDING) must be `bigint` minor units + ISO 4217 (CLAUDE.md §3.11), not personal.

### 2.3 Derived / in-transit personal data

- **Events** (`hrms.posting.*`): carry work attributes (office, station, state, HRA city class,
  order number) — deliberately **not** Aadhaar/PAN/bank/health. Standalone events stay OFF until a
  wired, entitled consumer exists (D-101 ratchet). The posting fact also rides `audit.event.record`.
- **Solver/policy sidecars** (PENDING): receive a frozen snapshot of **opaque ids + eligibility
  attributes**, never names or identity documents. No PII to an external LLM (P07/D-ST-17).
- **Notifications**: addresses resolved via identity (`users/:id/email`), not carried raw on domain
  events (M00 §2 gap S11).

## 3. Access control (who can see what)

| Principal | Access | Enforced by |
|---|---|---|
| Employee (self) | Own service/posting history, own preferences, own orders; **no** direct edit of certified records (§9) | `requireRole`; server-derived actor = employee; RLS |
| Command-centre officer | Movement data within **their jurisdiction** only | `requireRole` (staff-only, excludes citizen); jurisdiction-scoped lists (house rule 9) |
| Another tenant | **Nothing** | FORCE RLS + per-tenant `app.tenant_id`; cross-tenant tests (this PR + ST-M01-15b) |
| Another service | Only through declared contracts; posting write only via `applyPosting` from the authorised producer | DB-per-service; producer ACL (TB4); arch guards |
| Break-glass / support | Approved, time-boxed, fully audited; cross-tenant access raises an SRE alert | SECURITY.md §3 (platform-owned) |

Sensitive fields (Aadhaar, PAN, bank) are **never** returned on the HR directory surface regardless
of role (SECURITY.md §4.1) and are not duplicated into movement records.

## 4. Retention, deletion and data-principal rights (DPDP Act 2023)

**Facts recorded; the retention schedule itself is a legal/owner decision — PENDING.**

| Category | Current behaviour | DPDP consideration (PENDING legal review) |
|---|---|---|
| Posting ledger / occupancy | Append-only, retained as the statutory service record | Likely a legal-obligation retention (service book is a lifelong record); erasure request would be **restricted**, not honoured, while the obligation stands |
| Movement records (requests, orders, evidence) | Retained for audit/reproducibility (§21 auditor replay) | Retain for the cycle + statutory appeal/audit window; define the exact period with Legal |
| Command result / outbox / inbox | Purged on a schedule (succeeded 7d, rejected/failed 30d — #1979) by the scanner role | Operational data, not the system of record |
| Audit events | Hash-chained, immutable, retained ≥180 days (CERT-In) | Tamper-evidence requirement overrides erasure |
| Notifications | Delivery/retry state only | Short retention; addresses not stored on domain events |

**Data-principal rights (DPDP §11–§13):** access and correction of HRMS errors are via the portal's
"flag an error" flow (§9), **not** direct edits to certified records. The right to erasure is
constrained by the statutory retention of the service/posting record — this tension must be
resolved by Legal (what is erasable, what is restricted under a legal obligation). **PENDING.**

**Consent / notice:** processing is under a public function / employment relationship, not consent;
the tenant (State/Ministry) is the Data Fiduciary and must publish the notice. SmartTransfer records
the processing in audit; it does not itself issue the DPDP notice. **PENDING** — tenant/Legal.

**Breach:** CERT-In 6-hour incident reporting is automated at the platform level (SECURITY.md §6);
a SmartTransfer-specific breach runbook is **PENDING** (SEC/SRE, before pilot).

## 5. Cross-border / residency

No PII leaves the deployment: solver/policy run as in-cluster sidecars (D-ST-06, air-gapped-capable);
no PII to an external LLM until residency is decided (D-ST-17). Hosting/KMS posture (D-1/D-2) is an
owner decision. **PENDING.**

## 6. Open legal items (all flagged PENDING for the DPO/Legal)

1. The retention schedule and the erasure-vs-legal-obligation boundary for posting records (§4).
2. The DPDP notice and the Data Fiduciary/Processor roles between the tenant and the platform.
3. The interim "not digitally signed" order label and the move to real eSign (D-ST-12).
4. Whether `disability`/`blood_group`/hold context qualify as special-category data needing extra
   safeguards under the DPDP rules once notified.
5. The SmartTransfer breach runbook and the category-wise fairness reporting governance (D-ST-18).

> None of the above blocks M01 (schema, write path, isolation). They are recorded so the control or
> the legal decision is in place before the corresponding feature reaches a real tenant.
