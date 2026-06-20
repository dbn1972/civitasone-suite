You are building the Audit & Legal module for CivitasOne Suite. Read CLAUDE.md first.

## Context
Screen references (read ALL .html files):
- ~/CivitasOne/erpnext-develop/audit-module/web/
  Key screens: dashboard.html, audit-plan.html, audit-plan-detail.html, observation.html,
  observation-detail.html, atm.html, compliance-report.html, para-register.html,
  audit-para.html, dpc.html, pending-paras.html, department-response.html

- ~/CivitasOne/erpnext-develop/legal-module/web/ (if exists, else check civitasone-screens)
  Key screens: case-list.html, case-detail.html, hearing.html, notice.html,
  contract-review.html, lok-adalat.html, settlement.html

Schema: ~/CivitasOne/erpnext-develop/MODULES_AND_SCHEMA.md section 3.11

Services: services/audit-service (already scaffolded in 01-platform — EXTEND it), services/legal-service
  audit DB: civitas_audit, role: audit_svc, password: audit_dev_pw (already exists)
  legal DB: civitas_legal, role: legal_svc, password: legal_dev_pw
Prefix: audit_, legal_

NOTE: audit-service was scaffolded in 01-platform for the event-chain audit trail. This prompt EXTENDS it
with the internal audit management functionality (audit plans, paras, compliance). Do NOT delete the
audit_events table or the event consumer from 01-platform.

## Modules inside audit-service (ADDITIONAL L2 schemas to add)
src/modules/
  events/    — ALREADY EXISTS from 01-platform (audit trail, hash chain) — DO NOT MODIFY
  plan/      — internal audit plan, audit schedule
  observation/ — field observations, draft paras
  para/      — audit paras (DPC/ATM), department responses
  compliance/ — compliance tracking, pending paras register

## Modules inside legal-service (L2 schemas)
src/modules/
  cases/     — court cases, case types, parties
  hearings/  — hearing schedule, adjournments, orders
  notices/   — legal notices sent/received
  contracts/ — contract legal review, clearances
  settlements/ — Lok Adalat, out-of-court settlements

## Step 1 — Migration (audit-service extension)
Add to services/audit-service/migrations/0002_audit_mgmt.sql (DO NOT modify 0001):
  Schema plan:       audit_plans, audit_plan_items, audit_teams
  Schema observation: audit_observations, audit_working_papers
  Schema para:       audit_paras, audit_dept_responses, audit_para_status_history
  Schema compliance: audit_compliance_reports, audit_pending_register

services/legal-service/migrations/0001_init.sql:
  Schema cases:      legal_cases, legal_parties, legal_case_types
  Schema hearings:   legal_hearings, legal_orders
  Schema notices:    legal_notices, legal_notice_responses
  Schema contracts:  legal_contract_reviews, legal_clearances
  Schema settlements: legal_settlements, legal_lok_adalat

Critical constraints:
- audit_para: status check in ('draft','issued','replied','settled','pending_recovery','closed')
- audit_para.amount_involved_minor bigint (recoverable amount)
- audit_para_status_history: append-only
- legal_hearings: next_date date — updated on each adjournment
- legal_cases.status check in ('pending','disposed','appealed','stayed','settled')
- legal_notices.direction check in ('sent','received')
- Audit para linked to source event: source_ref text (opaque 'finance_gl:UUID' or 'procurement_po:UUID')
- All cross-module data via HTTP (audit-service reads finance/procurement via their APIs for context)

## Step 2 — CQRS routes + consumers (audit-service additions)
Audit plan:
  POST /audit/plans                     → audit.plan.create
  POST /audit/plans/:id/items           → audit.plan_item.create (per dept/unit)
  PATCH /audit/plans/:id/start          → audit.plan.start
  GET  /audit/plans/:id                 → cache → repo

Observations + paras:
  POST /audit/observations              → audit.observation.create (field work note)
  POST /audit/observations/:id/draft-para → audit.para.draft (elevate observation to para)
  POST /audit/paras/:id/issue           → audit.para.issue (send to department)
    Consumer: emit notification to department head
  POST /audit/paras/:id/response        → audit.para.dept_response (department reply)
  PATCH /audit/paras/:id/settle         → audit.para.settle
  PATCH /audit/paras/:id/pending_recovery → audit.para.pending_recovery
  GET  /audit/paras                     → cache → repo (paginated, filterable by status/dept)
  GET  /audit/compliance/pending        → cache → repo (pending para register)

Legal service:
  POST /legal/cases                     → legal.case.create
  POST /legal/cases/:id/hearings        → legal.hearing.create
  PATCH /legal/cases/:id/hearings/:hId/adjourn → legal.hearing.adjourn (set next_date)
  POST /legal/cases/:id/orders          → legal.order.record
  PATCH /legal/cases/:id/dispose        → legal.case.dispose
  POST /legal/notices                   → legal.notice.create (sent or received)
  POST /legal/notices/:id/respond       → legal.notice.respond
  POST /legal/contract-reviews          → legal.contract_review.create
  PATCH /legal/contract-reviews/:id/clear → legal.contract_review.clear
  POST /legal/settlements               → legal.settlement.create
  GET  /legal/cases/:id                 → cache → repo
  GET  /legal/cases?status=&type=       → cache → repo

## Step 3 — Domain rules
- Audit para immutability: once issued (status='issued'), body cannot be changed — only responses can be added
- Para status machine: draft → issued → replied → settled|pending_recovery → closed
- Legal case next_date: always updated on adjournment, consumer emits notification 3 days before
- Contract clearance: legal_contract_reviews.cleared_at must be set before procurement-service allows PO above threshold
- Pending recovery tracking: audit_para.amount_involved_minor flows into finance audit paras (via finance-service event)

## Step 4 — Events consumed
finance.gl.posted              → audit-service events consumer (already in 01-platform)
procurement.po.approved        → audit-service events consumer
finance.bill.passed            → audit-service events consumer

## Step 5 — Events emitted
audit.para.issued              → notification-service (department head)
audit.para.pending_recovery    → finance-service (flag for recovery)
legal.case.date_set            → notification-service (assigned counsel)
legal.contract_review.cleared  → procurement-service (unblock high-value PO)

## Step 6 — Tests
- Para state machine: draft → issued → replied → settled
- Para body immutable after issue: consumer rejects body update if status != 'draft'
- Legal adjournment: next_date updated, previous date archived in legal_hearings
- CQRS: POST /audit/paras/:id/issue → SQS → consumer → DB (MemoryQueue)

## Step 7 — Apply migration + typecheck + test
# Audit-service extension (add, do not rerun 0001)
docker exec -e PGPASSWORD=audit_dev_pw -i civitasone-postgres \
  psql -U audit_svc -d civitas_audit < services/audit-service/migrations/0002_audit_mgmt.sql
docker exec -e PGPASSWORD=legal_dev_pw -i civitasone-postgres \
  psql -U legal_svc -d civitas_legal < services/legal-service/migrations/0001_init.sql
cd services/audit-service && pnpm typecheck && pnpm test
cd services/legal-service && pnpm typecheck && pnpm test

Report: routes, tables, test results. Note CAG audit para categories visible in screens (performance, compliance, financial).
