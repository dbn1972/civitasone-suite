# CivitasOne Admin Operations Dashboard Runbook

The Admin Operations Dashboard at `/tenant-admin/operations` is for `platform_admin` and `super_admin` users. It gives an internal view of service health, PM2 process state, worker status, scheduler ownership, queue health, outbox backlog, and redacted recent errors.

## Deployment Checks

- `admin-service` must run on the same host or container environment that can execute `pm2 jlist`.
- Set `CIVITASONE_LOG_DIR` when logs are not stored in `/var/log/civitasone`.
- Keep PM2 process names aligned with `ecosystem.config.js`; scheduler ownership depends on names such as `hrms-worker`, `workflow-worker`, and `legal`.
- Confirm `GET /v1/admin/operations` returns `403` for `tenant_admin` and `200` for `platform_admin` or `super_admin`.
- Confirm log excerpts are redacted before display; raw secrets must never be shown in the UI.

## Required External Alerts

Use Uptime Kuma, Grafana/Prometheus, CloudWatch, or an equivalent external monitor. The dashboard is not a substitute for external alerting because it is unavailable when the app itself is down.

- Web app down: alert on `/` or a public health page.
- Gateway down: alert on gateway `/health` and `/ready`.
- Admin service down: alert on `admin-service` `/health` and `/ready`.
- Worker down: alert when any required `*-worker` PM2 process is not `online`.
- Queue unhealthy: alert when queue health check fails.
- Outbox backlog: alert when pending outbox messages grow across multiple checks.
- Error spike: alert when recent error-log matches increase.

## Current Instrumentation Gap

Most schedulers currently run inside workers via durable `setInterval` loops, but they do not all write to a shared `job_runs` table. Until that shared instrumentation exists, the dashboard can show scheduler owner health but not a verified last successful run for every scheduler.

To reach full job-monitoring maturity, add a shared scheduler run recorder used by every worker:

- Record `job_name`, `owner_process`, `started_at`, `finished_at`, `status`, `duration_ms`, `error_summary`, and `correlation_id`.
- Mark failed runs separately from PM2 process failures.
- Add alerts for stale `last_success_at` by scheduler.
- Keep retries idempotent and tied to persisted due items, not in-memory timer state.
