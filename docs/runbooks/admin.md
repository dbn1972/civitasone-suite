# Runbook: admin-service

> Tier 2. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% availability, p95 read < 300 ms.

- **Purpose:** platform administration — tenant lifecycle management (create/suspend/reactivate/edition-change/sync), module toggle (enable/disable modules per tenant), feature-flag management (platform-wide + per-tenant overrides + kill switch), data export (GDPR/DPDP compliance), webhook management (tenant-configured outbound webhooks), backup scheduling/triggering, break-glass access (emergency admin elevation with audit), scheduled-job management (CRUD + pause/resume/run-now), custom domain registration/verification, API key management, platform configuration, security/compliance dashboards, integration settings, and tenant health monitoring. Owns `civitas_admin`. 18 modules — the platform control plane.

- **Owner / escalation:** primary: Platform Engineering. Secondary: SRE. Page on break-glass abuse detection or feature-flag kill-switch failure.

- **Dependencies:**
  - Own Postgres DB (`civitas_admin`), RLS enabled, tenant-scoped (except platform-wide configs which use a system tenant).
  - Redis — feature-flag cache (must be fast — every request checks flags), webhook delivery queue, scheduled-job next-run cache.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for tenant lifecycle, module toggle, feature-flag CRUD/override/kill/manage, data-export, webhook CRUD/test, backup, break-glass, scheduled-job lifecycle, custom-domain lifecycle; events mirroring all admin mutations.
  - Cross-service: identity-service (tenant-to-identity sync), install-service (tenant provisioning on create), notification-service (webhook delivery failures), all services (feature-flag checks).
  - Webhook delivery: when tenant-configured webhooks fire, admin-service publishes events to external HTTP endpoints (retry 3x with exponential backoff; mark `failed` after exhaustion).

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: tenant count by edition/status, feature-flag activation rate, webhook delivery success rate, scheduled-job execution rate/failure, data-export queue depth, break-glass access count.
  - Alert: break-glass access opened = WARN (always review); feature-flag kill-switch activated = INFO (deliberate); webhook delivery failure rate > 20% = WARN; scheduled-job failure > 3 consecutive = WARN.

- **Common failure modes → action:**
  - *Feature-flag cache stale* → flags are cached in Redis with short TTL (60s). If a flag toggle isn't reflecting, check Redis health. In emergencies, the kill-switch bypasses cache (direct DB check) — use `admin.feature_flag.kill` for immediate effect.
  - *Break-glass session not closing* → break-glass provides temporary elevated access. Sessions have a configured TTL (usually 1h). If a session isn't auto-closing, verify the `admin.breakglass.close` scheduled event fires at expiry. If it didn't, manually close via admin API. Every break-glass action is audit-logged — review the session's activity.
  - *Tenant provisioning failure* → `admin.tenant.create` triggers install-service to provision databases/Keycloak realm. If provisioning fails midway, check install-service logs. Provisioning is resumable — re-triggering is safe (idempotent).
  - *Webhook delivery permanently failing* → after 3 retries, webhooks are marked failed. Common cause: tenant-provided URL is unreachable or returns non-2xx. Admin can test the endpoint via `admin.webhook.test` command. The webhook system never blocks internal operations — delivery is best-effort.
  - *Scheduled-job not firing* → scheduled jobs use cron expressions. If a job isn't running, check: (1) is it paused? (2) is the cron expression valid? (3) is the admin-service worker healthy? Jobs fire by publishing commands to the target service's topic — the job itself is just a scheduler.
  - *Data export timing out* → DPDP-compliant data exports can be large (full tenant data). Exports run asynchronously (`admin.data_export.process`). If timing out, the dataset may be too large — add pagination or date-range constraints. Export files are stored in S3/MinIO with tenant-scoped access.
  - *Custom domain verification failing* → DNS verification checks for CNAME/TXT records. If the check is failing, the tenant hasn't configured their DNS yet. This is expected — the verification will pass once DNS propagates (up to 48h).

- **Rollback:** redeploy previous image tag. Tenant state changes (suspend/reactivate) are reversible. Feature-flag changes are reversible. Break-glass sessions are time-limited and audited.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) verify feature-flag cache is rebuilt (force-invalidate all flag keys in Redis); (2) check if any tenants were provisioned during the gap (if provisioning completed but the admin-service record was lost, reconcile with install-service); (3) verify scheduled-job next-run times are recalculated from their cron expressions.
