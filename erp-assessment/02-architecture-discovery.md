# 02 — Architecture Discovery (actual, not aspirational)

## Classification: **MICROSERVICES (event-choreographed), DB-per-service** — genuine, not a distributed monolith.
Evidence: 38 independent services (`services/*`), each with its own Postgres database (per-service least-privilege DSN in `infra/docker-compose.prod.yml`), its own migrations, its own worker process. No shared application DB. Cross-service coupling is via **events (transactional outbox → queue)**, not cross-DB joins — verified: grep for cross-service DB access found none; the earlier choreography audit confirmed services talk via topics, and the RLS audit confirmed DB-per-service with per-service roles.

## Runtime stack (verified)
- **Language/framework:** TypeScript + Fastify per service; drizzle ORM; Node 20; pnpm workspace monorepo.
- **Data:** PostgreSQL (one DB per service), FORCE RLS tenant isolation; PgBouncer-aware pooling.
- **Cache:** single shared Redis (cache-only), tenant-aware keys (`packages/cache`).
- **Messaging:** `@civitasone/queue` facade over `queue-service` (drivers: memory/SQS/RabbitMQ); **transactional outbox** (`packages/outbox`, `_outbox.messages` + relay) + idempotent consumers (`_inbox.processed`, markProcessed-first); SNS-style per-service fan-out queues.
- **Auth:** Keycloak (RS256 JWT, JWKS verification in `packages/auth`).
- **Gateway:** `gateway-service` — prefix→upstream routing, JWT edge (sets x-tenant-id), circuit breaker; `module-guard` + `quota-check` built but **not wired** (dormant).
- **Web/mobile:** `apps/web` (Next.js 14 App Router) with real feature areas incl. visitor/meeting/court (added this session); `apps/mobile` (Flutter).
- **Deployment:** pm2 (`ecosystem.config.js` — 1 API + 1 worker per service); on-prem Helm (`infra/onprem/helm`, Redis Sentinel); observability via `packages/observability` (Prometheus metrics).

## Shared packages (the platform substrate)
`@civitasone/{db, cache, queue, queue-service, outbox, events, auth, types, config, observability, feature-flags, rate-limit}` + a `pool|silo|shard` tenant router (`packages/db/tenant-router.ts`, unwired). This substrate is what makes the 38 services consistent (CQRS 7-file module pattern: routes/commands/consumer/repo/schema/validators/domain + topics/worker).

## The 38 services (control-plane / platform / domain)
- **Platform/control-plane:** gateway, identity, tenant, policy, audit, notification, admin, install, metadata (stub), plugin, theme, telephony, queue, ml, knowledge, report, analytics.
- **Government domain (ERP):** hrms, payroll, finance, billing, procurement, contract, inventory, stock, asset, project, grant, estab, location, crm, helpdesk, citizen.
- **Newer domain services (built + hardened this session):** court (legal/adjudication), visitor (VMS), meeting (governance).

## Dependency shape
- **Inbound coupling:** gateway → all services; identity/tenant referenced widely (JWT tenant claim + tenant registry).
- **Event coupling:** infra topics `audit.event.record`→audit, `notification.send`→notification, `workflow.instance.create`→workflow are consumed cross-service. Domain events (`<svc>.*`) are largely **orphaned** cross-service (choreography audit: 154 domain topics, most unconsumed by siblings) — an integration-completeness gap, now partly closed (meeting decision.* → ERP intake, visitor security → notification).
- **No circular DB coupling** (DB-per-service prevents it); circular EVENT dependencies not observed at scale.

## Honest architecture assessment
A **genuinely modular microservices platform** with a strong, consistent substrate (CQRS + outbox + RLS + config engine). The architecture is sound and directionally excellent (~9/10). The gaps are operational maturity (tenancy tiering/placement unwired, queue fairness absent, RLS-under-real-role only partly closed) rather than structural — detailed in the tenancy reference architecture and RLS-readiness records.
