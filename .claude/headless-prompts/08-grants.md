You are building the Grants Management module for CivitasOne Suite. Read CLAUDE.md first.

## Context
Screen references (read ALL .html files):
- ~/CivitasOne/erpnext-develop/grants-module/web/
  Key screens: dashboard.html, grant-list.html, grant-detail.html, application.html,
  application-detail.html, installment.html, disbursement.html, utilisation.html,
  beneficiary.html, pfms-integration.html, dbt-transfer.html, compliance.html,
  audit-para.html, fund-reconciliation.html

Schema: ~/CivitasOne/erpnext-develop/MODULES_AND_SCHEMA.md section 3.9

Service: services/grant-service
  DB: civitas_grant, role: grant_svc, password: grant_dev_pw
Prefix: grant_

## Modules inside grant-service (L2 schemas)
src/modules/
  scheme/       — grant schemes, eligibility criteria
  application/  — grant applications, scoring, approvals
  disbursement/ — installments, PFMS transfers, DBT
  utilisation/  — UC submission, compliance, audit
  beneficiary/  — beneficiary master, bank accounts, Aadhaar seeding

## Step 1 — Migration
services/grant-service/migrations/0001_init.sql:
  Schema scheme:       grant_schemes, grant_eligibility_criteria
  Schema application:  grant_applications, grant_app_documents, grant_scores
  Schema disbursement: grant_installments, grant_disbursements, grant_pfms_records
  Schema utilisation:  grant_uc_statements, grant_compliance_reports, grant_audit_paras
  Schema beneficiary:  grant_beneficiaries, grant_bank_accounts, grant_aadhaar_links

Critical constraints:
- Money fields: bigint (paise), currency default 'INR'
- grant_applications.status check in ('draft','submitted','under_review','approved','rejected','withdrawn')
- grant_disbursements.mode check in ('PFMS','DBT','cheque','RTGS')
- grant_beneficiaries.aadhaar_token text (masked — store only last 4 digits + token, never full Aadhaar)
- grant_uc_statements: immutable after submission
- grant_disbursements.pfms_txn_id text (PFMS transaction reference for reconciliation)
- grant_schemes.sanction_ref text (opaque 'finance_sanction:UUID')
- Aadhaar seeding: grant_aadhaar_links stores Aadhaar-linked bank (NPCI mapper) — do not store raw Aadhaar

## Step 2 — CQRS routes + consumers
Scheme:
  POST /grants/schemes                  → grant.scheme.create
  POST /grants/schemes/:id/criteria     → grant.eligibility.create
  GET  /grants/schemes/:id              → cache → repo

Application:
  POST /grants/schemes/:id/applications → grant.application.submit
    Consumer: check eligibility criteria (age, income, category from beneficiary profile)
  PATCH /grants/applications/:id/score  → grant.application.score (committee scoring)
  PATCH /grants/applications/:id/approve → grant.application.approve
  PATCH /grants/applications/:id/reject  → grant.application.reject
  GET  /grants/applications/:id          → cache → repo

Disbursement:
  POST /grants/applications/:id/installments → grant.installment.create (n installments)
  POST /grants/installments/:id/disburse    → grant.disbursement.initiate
    Consumer: call finance-service POST /finance/payments/eft for PFMS/DBT transfer
    On success: emit grant.disbursement.completed
    On failure: emit grant.disbursement.failed (retry mechanism)
  POST /grants/pfms/reconcile              → grant.pfms.reconcile (match PFMS txn IDs)
  GET  /grants/installments?appId=         → cache → repo

Utilisation:
  POST /grants/applications/:id/uc         → grant.uc.submit (immutable)
  POST /grants/applications/:id/compliance → grant.compliance.report
  GET  /grants/applications/:id/uc         → cache → repo

Beneficiary:
  POST /grants/beneficiaries               → grant.beneficiary.create
  POST /grants/beneficiaries/:id/bank      → grant.beneficiary.link_bank
  POST /grants/beneficiaries/:id/aadhaar   → grant.beneficiary.seed_aadhaar
    Consumer: store ONLY masked Aadhaar token + last 4 digits (DPDP compliance)
  GET  /grants/beneficiaries/:id           → cache → repo

## Step 3 — Domain rules
- Aadhaar: NEVER store full 12-digit Aadhaar. Consumer extracts last 4 digits + derives token via SHA-256(aadhaar + salt). Raw input discarded immediately.
- Eligibility check: consumer validates applicant against grant_eligibility_criteria (age range, income limit, category)
- Disbursement: total disbursed cannot exceed approved grant amount
- UC submission: expenditure must be ≤ total disbursed (consumer validates)
- PFMS reconciliation: match pfms_txn_id in response with grant_pfms_records, update status

## Step 4 — Events consumed
finance.payment.made → grant.disbursement.completed (PFMS confirmation)

## Step 5 — Events emitted
grant.application.approved  → notification-service (beneficiary email/SMS)
grant.disbursement.completed → notification-service + audit-service
grant.disbursement.failed    → notification-service (admin alert)
grant.uc.submitted          → audit-service

## Step 6 — Tests
- Aadhaar masking: input '123456789012' → stored token only, raw never in DB
- Eligibility rejection: applicant age 60 vs criteria max_age 45 → application.rejected
- UC expenditure > disbursed: consumer rejects
- CQRS: POST /grants/installments/:id/disburse → SQS → consumer → DB (MemoryQueue)

## Step 7 — Apply migration + typecheck + test
docker exec -e PGPASSWORD=grant_dev_pw -i civitasone-postgres \
  psql -U grant_svc -d civitas_grant < services/grant-service/migrations/0001_init.sql
cd services/grant-service && pnpm typecheck && pnpm test

Report: routes, tables, test results. Flag DPDP Section 4 compliance notes for Aadhaar handling.
