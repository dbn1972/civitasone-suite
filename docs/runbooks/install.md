# Runbook: install-service

> Tier 2 (critical during provisioning, idle otherwise). Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% during provisioning operations, best-effort otherwise (not on hot path after install completes).

- **Purpose:** platform installation orchestration — DAG-based wizard state machine (mode selection → adapter config → validation → admin creation → bootstrap → health → readiness score → go-live), silo tenant database provisioning (CREATE DATABASE + migration walk), enterprise readiness scoring (0-100 across 7 categories), and installation stage management. Owns `civitas_install`. 3 modules. Active during initial setup and new-tenant provisioning; idle during normal operations.

- **Owner / escalation:** primary: Platform Engineering. Secondary: SRE. Page on tenant provisioning failure (new tenant onboarding blocked).

- **Dependencies:**
  - Own Postgres DB (`civitas_install`), RLS enabled. Stores installation state, provisioning progress, readiness scores.
  - Redis — provisioning job status cache.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for orchestrator steps, provisioning requests, stage execution.
  - Requires elevated DB privileges during provisioning: `PROVISIONING_RUNNER_DSN` with CREATE DATABASE + CREATE ROLE permissions (separate from the service's normal DB user).
  - Cross-service: admin-service (triggers provisioning on new tenant), identity-service (Keycloak realm creation during bootstrap), all services (migration walk creates each service's schema in the new tenant DB).
  - DAG orchestrator: steps have dependencies (must complete in order). The wizard is resumable — if a step fails, subsequent steps wait. Re-triggering resumes from the failed step.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate).
  - Grafana: provisioning jobs by status (pending/in-progress/completed/failed), average provisioning time, readiness score distribution.
  - Alert: provisioning job failed = WARN (new tenant blocked); provisioning stuck > 10 min = WARN.

- **Common failure modes → action:**
  - *Tenant provisioning stuck at DB creation* → verify `PROVISIONING_RUNNER_DSN` has CREATE DATABASE privileges. Common cause: Postgres max connections reached (can't create new DB sessions). Check connection pool utilization.
  - *Migration walk failing for a specific service* → the provisioner runs each service's migrations sequentially. If one service's migration fails, it blocks subsequent services. Check the failing migration SQL — usually a syntax error or missing dependency (CREATE EXTENSION, function reference). Fix the migration and re-trigger provisioning (resumable from the failed service).
  - *Readiness score stuck below pass bar (85)* → the readiness scorer checks 7 categories. If a category is failing, the remediation recommendations in the score output explain what's wrong. Common issues: Redis not configured (Reliability), backup not scheduled (DR), or healthcheck endpoint not responding (Observability).
  - *Wizard step cycle detected* → the DAG orchestrator detects cycles at build time. If somehow a cycle is introduced (code bug), the wizard will error. This indicates a configuration bug in the step dependency graph — not a runtime data issue.
  - *Install endpoint unreachable after initial setup* → install-service is only needed during provisioning. Some deployments shut it down after go-live. If a new tenant needs provisioning, ensure the service is running.

- **Rollback:** redeploy previous image tag. Provisioning state is tracked — a rollback doesn't undo a completed provisioning (databases created stay created). Failed provisioning can be re-attempted.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) check if any provisioning jobs were in-flight during the gap — they need to be re-triggered (the partially-created DB may need cleanup first); (2) readiness scores are recalculable at any time (they query live state).
