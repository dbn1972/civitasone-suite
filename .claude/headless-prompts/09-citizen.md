You are building the Citizen Services module for CivitasOne Suite. Read CLAUDE.md first.

## Context
Screen references (read ALL .html files):
- ~/CivitasOne/erpnext-develop/citizen-module/web/
  Key screens: portal-home.html, service-directory.html, application.html, tracking.html,
  grievance.html, grievance-detail.html, grievance-escalation.html, feedback.html,
  rti-portal.html, rti-detail.html, certificate.html, noc.html, licence.html,
  helpdesk.html, ticket.html, analytics.html, sla-dashboard.html

Schema: ~/CivitasOne/erpnext-develop/MODULES_AND_SCHEMA.md section 3.10

Service: services/citizen-service
  DB: civitas_citizen, role: citizen_svc, password: citizen_dev_pw
Prefix: citizen_

## Modules inside citizen-service (L2 schemas)
src/modules/
  portal/      — service directory, citizen profile, DigiLocker integration
  application/ — service applications (certificates, NOCs, licences), status tracking
  grievance/   — grievance registration, assignment, escalation, resolution
  rti/         — RTI portal (citizen-facing), CPIO workflow
  helpdesk/    — support tickets, CPGRAMS integration stub
  analytics/   — service delivery KPIs, SLA dashboard

## Step 1 — Migration
services/citizen-service/migrations/0001_init.sql:
  Schema portal:      citizen_profiles, citizen_services, citizen_service_categories
  Schema application: citizen_applications, citizen_app_documents, citizen_status_history
  Schema grievance:   citizen_grievances, citizen_grievance_actions, citizen_escalations
  Schema rti:         citizen_rti_requests, citizen_rti_responses, citizen_rti_appeals
  Schema helpdesk:    citizen_tickets, citizen_ticket_notes
  Schema analytics:   citizen_sla_configs, citizen_delivery_metrics

Critical constraints:
- citizen_applications.status check in ('submitted','under_review','pending_docs','approved','rejected','issued')
- citizen_grievances.status check in ('registered','assigned','in_progress','resolved','closed','reopened')
- citizen_rti_requests.deadline date (= created_at + 30 days, per RTI Act 2005)
- citizen_grievances.priority check in ('low','normal','high','urgent')
- citizen_sla_configs: service_type, max_days int — SLA tracking per service type
- citizen_profiles: no Aadhaar full number stored; link via DigiLocker token only
- citizen_app_documents: doc_url text (S3 pre-signed or DigiLocker URL, never stored file)
- citizen_status_history: append-only (every status change creates a new row)

## Step 2 — CQRS routes + consumers
Portal/profile:
  POST /citizen/profiles               → citizen.profile.create (self-registration)
  GET  /citizen/services               → cache → repo (public: no auth required)
  GET  /citizen/services/:id           → cache → repo (service details + required docs)

Applications:
  POST /citizen/applications           → citizen.application.submit
    Consumer: validate required documents present, set deadline from SLA config
  PATCH /citizen/applications/:id/status → citizen.application.status_update (officer action)
  POST /citizen/applications/:id/documents → citizen.application.doc_upload (returns pre-signed S3 URL)
  GET  /citizen/applications/:id       → cache → repo (with status history)
  GET  /citizen/applications?citizenId= → cache → repo (my applications)

Grievances:
  POST /citizen/grievances             → citizen.grievance.register
    Consumer: auto-assign to relevant department, set priority
  PATCH /citizen/grievances/:id/assign → citizen.grievance.assign (officer)
  POST /citizen/grievances/:id/actions → citizen.grievance.action (officer note + status)
  PATCH /citizen/grievances/:id/resolve → citizen.grievance.resolve
  PATCH /citizen/grievances/:id/escalate → citizen.grievance.escalate (auto after SLA breach)
  GET  /citizen/grievances/:id         → cache → repo (with action trail)
  GET  /citizen/grievances?citizenId=  → cache → repo

RTI (citizen portal):
  POST /citizen/rti                    → citizen.rti.file (public: lighter auth)
    Consumer: set deadline = now + 30 days, notify CPIO via estab-service
  POST /citizen/rti/:id/respond        → citizen.rti.response_receive (officer uploads response)
  PATCH /citizen/rti/:id/appeal        → citizen.rti.appeal (if dissatisfied)
  GET  /citizen/rti/:id                → cache → repo

Helpdesk:
  POST /citizen/tickets                → citizen.ticket.create
  POST /citizen/tickets/:id/notes      → citizen.ticket.note (officer or citizen)
  PATCH /citizen/tickets/:id/close     → citizen.ticket.close
  GET  /citizen/tickets/:id            → cache → repo

Analytics (read-only):
  GET  /citizen/analytics/sla          → aggregated from delivery_metrics (cache → repo)
  GET  /citizen/analytics/grievances   → pending/resolved by department

## Step 3 — Domain rules
- SLA breach detection: consumer scheduled check → if application older than sla_config.max_days and not resolved → emit citizen.application.sla_breached
- Grievance auto-escalation: if grievance.status = 'assigned' and updated_at < now - sla_days → consumer escalates
- RTI deadline: 30 calendar days from filing (RTI Act 2005 s.7)
- Document URL: consumer returns pre-signed S3 URL (60 min expiry) — never store binary in DB
- Status history: append-only — consumer inserts new row in citizen_status_history on every status change

## Step 4 — Events consumed
estab.rti.responded → citizen.rti.response_receive (sync RTI status from estab-service)

## Step 5 — Events emitted
citizen.application.approved      → notification-service (SMS + email to citizen)
citizen.application.sla_breached  → notification-service (admin + dept head alert)
citizen.grievance.resolved        → notification-service (citizen)
citizen.rti.filed                 → estab-service (CPIO intake via queue)
citizen.grievance.escalated       → notification-service + audit-service

## Step 6 — Tests
- RTI deadline: consumer sets deadline = today + 30 days
- SLA breach: application older than sla_config.max_days → event emitted
- Grievance state machine: registered → assigned → in_progress → resolved
- CQRS: POST /citizen/grievances → SQS → consumer → DB (MemoryQueue + MemoryCache)

## Step 7 — Apply migration + typecheck + test
docker exec -e PGPASSWORD=citizen_dev_pw -i civitasone-postgres \
  psql -U citizen_svc -d civitas_citizen < services/citizen-service/migrations/0001_init.sql
cd services/citizen-service && pnpm typecheck && pnpm test

Report: routes, tables, test results. Note CPGRAMS / National Grievance Portal integration points visible in screens.
