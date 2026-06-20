You are building the Admin & Billing control plane for CivitasOne Suite. Read CLAUDE.md first.

## Context
Screen references (read ALL .html files):
- ~/CivitasOne/erpnext-develop/civitasone-screens/web/
  Key screens: setup.html, tenant-onboarding.html, subscription.html, billing.html,
  usage-dashboard.html, feature-flags.html, edition.html, module-config.html,
  system-health.html, backup.html, audit-trail.html (admin view)

Schema: ~/CivitasOne/erpnext-develop/MODULES_AND_SCHEMA.md section 3.13

Services: services/admin-service, services/billing-service
  admin DB: civitas_admin, role: admin_svc, password: admin_dev_pw
  billing DB: civitas_billing, role: billing_svc, password: billing_dev_pw
Prefix: admin_, billing_

NOTE: This is the control-plane layer. admin-service manages tenant lifecycle and configuration.
billing-service manages subscription, usage tracking, and invoicing. Together these are the
'super-admin' layer that operates ABOVE the tenant boundary — routes here do NOT carry tenantId
as a resource discriminator; instead they operate ON tenants.

## Modules inside admin-service (L2 schemas)
src/modules/
  tenants/    — tenant master (extends basic tenants from tenant-service)
  config/     — edition (Govt/PSU/SmallOffice), module toggles, feature flags
  health/     — service health aggregation, dependency status
  backup/     — backup schedules, restore points
  support/    — break-glass access log, support tickets (internal)

## Modules inside billing-service (L2 schemas)
src/modules/
  plans/      — subscription plans, features per plan
  subscriptions/ — tenant subscriptions, free trial, activation
  usage/      — API call counters, storage usage, user count
  invoices/   — invoice generation, payment records
  payments/   — payment gateway integration stub (Razorpay / NeSL for govt)

## Step 1 — Migration
services/admin-service/migrations/0001_init.sql:
  Schema tenants:  admin_tenants (mirrors key fields from tenant.tenants, kept in sync via events)
  Schema config:   admin_editions, admin_module_configs, admin_feature_flags
  Schema health:   admin_health_snapshots
  Schema backup:   admin_backup_schedules, admin_backup_runs
  Schema support:  admin_break_glass_log, admin_support_tickets

services/billing-service/migrations/0001_init.sql:
  Schema plans:         billing_plans, billing_plan_features
  Schema subscriptions: billing_subscriptions, billing_trials
  Schema usage:         billing_usage_events, billing_usage_aggregates
  Schema invoices:      billing_invoices, billing_invoice_items
  Schema payments:      billing_payments, billing_gateway_txns

Critical constraints:
- admin_tenants: edition check in ('govt_dept','psu','small_office')
- admin_feature_flags: flag_key text, enabled boolean, overrides jsonb (per-tenant overrides)
- billing_subscriptions.status check in ('trial','active','suspended','cancelled')
- billing_invoices: status check in ('draft','issued','paid','overdue','waived')
- billing_usage_events: append-only (one row per billable event — API calls, storage, users)
- admin_break_glass_log: immutable, linked to audit_events (cross-ref by correlation_id)
- billing_plans.govt_exempt boolean (government tenants exempt from billing — set true by default)

## Step 2 — CQRS routes + consumers
Admin — tenant management:
  POST  /admin/tenants                 → admin.tenant.create
    Consumer: creates record in admin_tenants, applies edition config, activates modules
    Also publishes to tenant-service's topic: tenant.tenant.create (bootstraps the actual tenant)
  PATCH /admin/tenants/:id/edition     → admin.tenant.edition_change
  PATCH /admin/tenants/:id/suspend     → admin.tenant.suspend
  PATCH /admin/tenants/:id/reactivate  → admin.tenant.reactivate
  GET  /admin/tenants/:id              → cache → repo
  GET  /admin/tenants                  → cache → repo (super-admin list, paginated)

Config:
  GET  /admin/tenants/:id/config       → cache → repo (edition + enabled modules + flags)
  PATCH /admin/tenants/:id/modules/:module/toggle → admin.module.toggle (enable/disable module)
  POST /admin/feature-flags            → admin.feature_flag.create
  PATCH /admin/feature-flags/:key/override → admin.feature_flag.override (per-tenant)
  GET  /admin/feature-flags            → cache → repo

Health:
  GET  /admin/health                   → aggregate: poll /health of each service, return summary
    Implementation: fan-out HTTP GET to all 19 service /health endpoints concurrently (Promise.all)
    Cache result for 30s (do not cache for longer — needs to be near-live)
  GET  /admin/health/:service          → proxy to individual service /health

Backup:
  POST /admin/tenants/:id/backup/schedule → admin.backup.schedule (cron expression)
  POST /admin/tenants/:id/backup/run     → admin.backup.trigger (manual)
  GET  /admin/tenants/:id/backup/runs    → cache → repo

Break-glass:
  POST /admin/support/break-glass      → admin.breakglass.open (opens cross-tenant read access)
    Consumer: writes to admin_break_glass_log AND emits to audit-service
  PATCH /admin/support/break-glass/:id/close → admin.breakglass.close

Billing — plans:
  POST  /billing/plans                 → billing.plan.create (super-admin only)
  GET   /billing/plans                 → cache → repo (public: unauthenticated OK)
  GET   /billing/plans/:id             → cache → repo

Subscriptions:
  POST  /billing/subscriptions         → billing.subscription.create (on tenant onboarding)
  PATCH /billing/subscriptions/:id/activate → billing.subscription.activate
  PATCH /billing/subscriptions/:id/cancel   → billing.subscription.cancel
  GET   /billing/tenants/:id/subscription   → cache → repo

Usage:
  POST  /billing/usage                 → billing.usage.record (called internally by API gateway)
    Consumer: append to billing_usage_events, update billing_usage_aggregates
  GET   /billing/tenants/:id/usage?month= → cache → repo (monthly summary)

Invoices:
  POST  /billing/invoices/generate     → billing.invoice.generate (monthly job)
    Consumer: aggregate usage for billing period, create billing_invoice + items
    Skip if govt_exempt=true
  PATCH /billing/invoices/:id/issue    → billing.invoice.issue (send to tenant)
  PATCH /billing/invoices/:id/pay      → billing.invoice.pay (record payment)
  GET   /billing/tenants/:id/invoices  → cache → repo

## Step 3 — Domain rules
- Only super-admin role (no tenantId claim in JWT) can access /admin/* and /billing/*
- Break-glass: every open must have a ticket_id reference; auto-expires in 2 hours
- Government tenants: billing_plans.govt_exempt = true → no invoice generated; usage still tracked
- Trial: billing_trials.expires_at = created_at + 30 days; on expiry → suspend subscription
- Module toggle: disabled module's routes return 403 with MODULE_DISABLED error code
- Feature flag resolution order: global → edition-level → per-tenant override (applied in that precedence)

## Step 4 — Events consumed
tenant.tenant.created → admin.tenant.sync (keep admin_tenants up to date)

## Step 5 — Events emitted
admin.tenant.suspended        → notification-service (tenant admin alert)
admin.tenant.created          → billing.subscription.create (auto-provision trial)
billing.subscription.expired  → admin.tenant.suspend
billing.invoice.issued        → notification-service (invoice PDF email)
admin.breakglass.opened       → audit-service + notification-service (SRE alert)

## Step 6 — Tests
- Feature flag resolution order: global=false, tenant override=true → returns true
- Govt exempt: invoice generate skipped when govt_exempt=true
- Break-glass auto-expiry: opened_at + 2h = expires_at (domain pure function)
- Health fan-out: 2 services return 200, 1 returns 503 → overall health = degraded
- CQRS: POST /admin/tenants → SQS → consumer → DB (MemoryQueue + MemoryCache)

## Step 7 — Apply migration + typecheck + test
docker exec -e PGPASSWORD=admin_dev_pw -i civitasone-postgres \
  psql -U admin_svc -d civitas_admin < services/admin-service/migrations/0001_init.sql
docker exec -e PGPASSWORD=billing_dev_pw -i civitasone-postgres \
  psql -U billing_svc -d civitas_billing < services/billing-service/migrations/0001_init.sql
cd services/admin-service && pnpm typecheck && pnpm test
cd services/billing-service && pnpm typecheck && pnpm test

Report: routes, tables, test results. Confirm govt_exempt billing path works. Confirm break-glass emits to audit.
