You are building the Platform module for CivitasOne Suite on a remote EC2 server.
Read CLAUDE.md first — all architecture rules apply (CQRS, L1/L2 isolation, no cross-service SQL, zod at boundary, audit every mutation).

## Context
Screen references (read these HTML files for UI/field requirements):
- ~/CivitasOne/erpnext-develop/platform-module/web/ (all .html files)
- ~/CivitasOne/erpnext-develop/civitasone-screens/web/ (dashboard.html, setup.html)

Schema reference: ~/CivitasOne/erpnext-develop/MODULES_AND_SCHEMA.md section 3.1

Services to build:
- services/identity-service (database: civitas_identity, prefix: identity_)
- services/tenant-service already exists — extend it
- services/policy-service (database: civitas_policy, prefix: policy_)
- services/audit-service (database: civitas_audit, prefix: audit_)
- services/notification-service (database: civitas_notification, prefix: notification_)

## Step 1 — identity-service schema + migration
Read the schema tables: identity_users, identity_sessions, identity_idp, identity_service_accounts
Read the screen files in platform-module/web/ for field-level requirements (login.html, users.html, mfa.html, idp.html if present)
Write services/identity-service/migrations/0001_init.sql with:
- All tables in the identity.* schema (identity schema already created by bootstrap)
- Standard audit columns on every table: id uuid pk default gen_random_uuid(), tenant_id uuid not null, created_at timestamptz default now(), updated_at timestamptz default now(), created_by uuid not null, updated_by uuid not null, version int not null default 1
- Indexes on tenant_id, email, status
- _outbox.messages and _inbox.processed tables (same as tenant-service)

## Step 2 — identity-service CQRS implementation
Read services/tenant-service/src/ as the template — replicate the same structure:
  src/modules/identity/{users,sessions,mfa}/
    domain.ts   — pure state-machine transitions (active/suspended/locked)
    schema.ts   — Drizzle table definitions matching the migration
    repo.ts     — DB queries (READ ONLY via @civitasone/cache getOrLoad)
    commands.ts — command types + zod validators
    consumer.ts — SQS consumer: write to Postgres via outbox, check _inbox.processed idempotency
    queries.ts  — read handlers: cache.getOrLoad → repo fallback
    routes.ts   — Fastify routes: POST validates with zod → publishes to SQS → returns 202
  src/shared/{db,infra,outbox,context}.ts (same as tenant-service)
  src/topics.ts — SQS topic names: identity.user.create, identity.user.update, identity.user.deactivate, identity.session.revoke
  src/app.ts — Fastify app with /health, /metrics, JWT auth via @civitasone/auth
  src/index.ts — start server
  src/worker.ts — start SQS consumer

Key routes:
  POST   /identity/users              → identity.user.create
  GET    /identity/users/:id          → cache → repo
  GET    /identity/users?tenantId=    → cache → repo (paginated)
  PATCH  /identity/users/:id/status   → identity.user.update
  DELETE /identity/users/:id          → identity.user.deactivate
  POST   /identity/sessions           → identity.session.create (login)
  DELETE /identity/sessions/:id       → identity.session.revoke
  POST   /identity/users/:id/mfa      → identity.mfa.enable

## Step 3 — policy-service
Same structure. Tables: policy_roles, policy_permissions, policy_abac, policy_breakglass
Topics: policy.role.create, policy.role.update, policy.binding.create, policy.binding.revoke
Routes:
  POST /policy/roles
  GET  /policy/roles/:id
  POST /policy/roles/:id/permissions
  POST /policy/bindings           (assign role to user)
  DELETE /policy/bindings/:id
  POST /policy/breakglass         (support mode — emits audit event + alert)

## Step 4 — audit-service
Tables: audit_events (append-only, hash-chained), audit_exports
This service ONLY consumes events — it never has write routes.
Subscribe to the SQS topic audit.event.ingest (already created).
Consumer: validate event, compute prev_hash chain, insert audit_events row.
Routes (read-only):
  GET /audit/events?tenantId=&from=&to=&type=
  GET /audit/events/:id
  POST /audit/exports (trigger async export → S3 via LocalStack)

## Step 5 — notification-service
Tables: notification_templates, notification_deliveries, notification_prefs
Subscribe to notification.send SQS topic.
Consumer: look up template, resolve channel, write delivery record, emit via channel stub (log for now).
Routes:
  POST /notifications/templates
  GET  /notifications/templates
  POST /notifications/preferences/:userId
  GET  /notifications/deliveries?userId=

## Step 6 — tests
For each service write tests/[service].test.ts:
- Domain transition tests (pure)
- CQRS wiring test using MemoryQueue + MemoryCache (same pattern as tenant-service tests)
- One route integration test using supertest against real Fastify instance (no real DB needed — mock repo)

## Step 7 — apply migrations
Run for each service:
docker exec -e PGPASSWORD=[role]_dev_pw -i civitasone-postgres \
  psql -U [role]_svc -d civitas_[service] < services/[service]/migrations/0001_init.sql

## Step 8 — typecheck + test
cd services/identity-service && pnpm typecheck && pnpm test
cd services/policy-service && pnpm typecheck && pnpm test
cd services/audit-service && pnpm typecheck && pnpm test
cd services/notification-service && pnpm typecheck && pnpm test

Report: list of routes created, tables created, test results, any deviations from plan.
