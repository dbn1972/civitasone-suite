You are building the Projects & Schemes module for CivitasOne Suite. Read CLAUDE.md first.

## Context
Screen references (read ALL .html files):
- ~/CivitasOne/erpnext-develop/projects-module/web/
  Key screens: dashboard.html, project-list.html, project-detail.html, task-board.html,
  milestone.html, gantt.html, fund-release.html, utilisation.html, uc-statement.html,
  scheme-list.html, scheme-detail.html, component.html, physical-progress.html,
  financial-progress.html, dpr.html, geo-tagging.html, outcome.html

ERPNext reference: ~/CivitasOne/erpnext-develop/erpnext/projects/doctype/

Schema: ~/CivitasOne/erpnext-develop/MODULES_AND_SCHEMA.md section 3.8

Service: services/project-service
  DB: civitas_project, role: project_svc, password: project_dev_pw
Prefix: project_

## Modules inside project-service (L2 schemas)
src/modules/
  project/    — project master, tasks, milestones, Gantt
  scheme/     — scheme master, components, fund releases
  progress/   — physical progress, financial progress, DPR
  utilisation/— UC (Utilisation Certificate) statements
  geo/        — geo-tagging, coordinates, site photos

## Step 1 — Migration
services/project-service/migrations/0001_init.sql:
  Schema project:    project_projects, project_tasks, project_milestones, project_members
  Schema scheme:     project_schemes, project_scheme_components, project_fund_releases
  Schema progress:   project_physical_progress, project_financial_progress, project_dprs
  Schema utilisation: project_uc_statements, project_uc_items
  Schema geo:        project_geo_tags, project_site_photos

Critical constraints:
- Money fields: bigint (paise), currency default 'INR'
- project_projects.status check in ('planned','active','on_hold','completed','cancelled')
- project_fund_releases.status check in ('pending','approved','disbursed','returned')
- project_uc_statements: immutable after submission (append-only like notings)
- project_schemes.sanction_ref text (opaque 'finance_sanction:UUID')
- project_tasks: parent_task_id uuid (self-referencing for sub-tasks)
- project_dprs: dpr_date date, submitted_by uuid — DPR once submitted cannot be deleted
- project_geo_tags: lat numeric(10,7), lon numeric(10,7)

## Step 2 — CQRS routes + consumers
Project:
  POST /projects                        → project.project.create
  POST /projects/:id/tasks              → project.task.create (with optional parent_task_id)
  PATCH /projects/:id/tasks/:taskId/status → project.task.status (update task status)
  POST /projects/:id/milestones         → project.milestone.create
  PATCH /projects/:id/milestones/:mId/complete → project.milestone.complete
  GET  /projects/:id                    → cache → repo (with tasks + milestones)
  GET  /projects?tenantId=&status=      → cache → repo (paginated)

Schemes:
  POST /projects/schemes                → project.scheme.create
  POST /projects/schemes/:id/components → project.scheme_component.create
  POST /projects/schemes/:id/fund-releases → project.fund_release.create
    Consumer: validate sanction balance (call finance-service GET /finance/sanctions/:id/available)
    If approved: emit project.fund_release.approved → finance-service posts GL
  PATCH /projects/schemes/:id/fund-releases/:rId/disburse → project.fund_release.disburse
  GET  /projects/schemes/:id            → cache → repo

Progress:
  POST /projects/:id/physical-progress  → project.physical_progress.record
  POST /projects/:id/financial-progress → project.financial_progress.record
  POST /projects/:id/dpr                → project.dpr.submit (immutable after submit)
  GET  /projects/:id/progress           → cache → repo (aggregated)

Utilisation:
  POST /projects/schemes/:id/uc-statements → project.uc.submit (immutable)
  GET  /projects/schemes/:id/uc-statements → cache → repo

Geo:
  POST /projects/:id/geo-tags           → project.geo.tag
  POST /projects/:id/site-photos        → project.photo.upload (S3 pre-signed URL flow)
  GET  /projects/:id/geo-tags           → cache → repo

## Step 3 — Domain rules
- Fund release cannot exceed scheme component allocation
- Physical progress %: weighted sum of component physical % × component weight
- UC statement: expenditure must be ≤ fund released to date
- DPR: once project.dpr.submit succeeds, no subsequent submit can overwrite the same dpr_date
- Milestone completion: marks tasks complete if all sub-tasks done
- Scheme sanction balance: finance-service HTTP call (same as procurement pattern)

## Step 4 — Events
project.fund_release.approved → finance-service (GL debit fund release, credit bank)
project.milestone.completed   → notification-service (project members)
project.uc.submitted          → audit-service (audit trail)
project.scheme.created        → finance-service (link scheme to sanction head)

## Step 5 — Tests
- Physical progress weighted: components A=40%, B=60% of total; A=50% physical, B=75% physical → overall = 65%
- Fund release exceeds allocation: reject
- UC expenditure > released: reject in domain
- CQRS: POST /projects/schemes/:id/fund-releases → SQS → consumer → DB (MemoryQueue)

## Step 6 — Apply migration + typecheck + test
docker exec -e PGPASSWORD=project_dev_pw -i civitasone-postgres \
  psql -U project_svc -d civitas_project < services/project-service/migrations/0001_init.sql
cd services/project-service && pnpm typecheck && pnpm test

Report: routes, tables, test results. Flag any PFMS/DARPAN schema fields visible in screens.
