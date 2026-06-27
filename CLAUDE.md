# CivitasOne Suite — Claude Code Operating Rules

These rules are loaded automatically by Claude Code on every session in this repo.
Every output, every PR, every line of code must follow them. No exceptions.

---

## 1. Product context

- **Product:** CivitasOne Suite — Unified Enterprise Suite for Government, PSU, and Small Offices
- **Build type:** Greenfield. Zero Frappe / Python carry-over. No migration.
- **Editions:** Small Office, PSU, Govt Department — packaged via theme + entitlements at install time, NOT via code forks.
- **Source of truth (binding, in `docs/`):**
  - `docs/steering/00-STEERING-INDEX.md` (map of all governing docs — start here)
  - `docs/ARCHITECTURE.md` (architecture L1/L2 + CQRS) · `docs/STANDARDS.md` (API, validation, errors, testing, quality)
  - `docs/SECURITY.md` (security + DPDP/CERT-In + SAST gate) · `docs/PERFORMANCE_DESIGN.md`
  - `.claude/prompts` + `.claude/skills` (workflow steering)
  - `docs/FINAL-UAT-GAP-REPORT.md` (current status + scores)
  - _Archived:_ `archive/docs/MASTER_BUILD_BRIEF.md`, `archive/docs/EXECUTION_PLAN.md`

---

## 2. Stack — non-negotiable

| Layer | Tech |
|---|---|
| Backend | Node 20+, Fastify 4, TypeScript strict, Drizzle ORM |
| Database | PostgreSQL 16 only |
| Cache | Redis 7 (Sentinel on-prem, ElastiCache on AWS) |
| Queue | Adapter pattern over SQS / Kafka / RabbitMQ — services use `@civitasone/queue` only |
| Object storage | S3 / MinIO via adapter |
| Search | Meilisearch |
| Auth | Keycloak (OIDC/SAML) + JWT with role claims |
| Web | Next.js 14 App Router, React 18, Tailwind, ui-kit components only |
| Mobile | Flutter 3.22+, Riverpod, go_router, Dio |
| Monorepo | pnpm workspaces + Turborepo |

---

## 3. Architecture rules — these are tested in CI

1. **Database per service (hybrid).** One Postgres 16 cluster, but **one database per service** with **its own DB login**, granted access to **only its own database**. **Zero cross-database grants** — a service physically cannot read another service's data. Any service is liftable to a dedicated cluster by changing one connection string (no code change).
2. **One service, one prefix.** Every table in a service starts with `{service}_`. No exceptions. Cross-prefix joins are forbidden — CI greps for them.
3. **No cross-service SQL.** All cross-service reads go through HTTP APIs. All cross-service writes go through the queue. No service opens a connection with another service's credentials.
4. **Module isolation inside a service (L2).** A service is split into bounded-context modules under `src/modules/{module}/`, each owning its **own schema** (`budget.*`, `gl.*`, …). A module's repo queries **only its own schema** — **no JOIN across module schemas**, no importing another module's repo/schema file. Cross-module data goes via in-process domain interface or events; cross-module views via read models / `report-service`. CI greps for cross-module joins. Every module must be independently extractable into its own service with zero data untangling.
5. **Every service has** `/health`, `/metrics`, structured JSON logs, and a `package.json` with the standard script set.
6. **Every entity has** `id`, `tenantId`, `createdAt`, `updatedAt`, `createdBy`, `updatedBy`, `version`.
7. **Every endpoint is authenticated** unless explicitly marked public in `policy-service`.
8. **Every mutation emits an audit event** via `@civitasone/events`. CI greps for missing emissions.
9. **Every input validated with `zod`** at the route boundary. No raw `req.body` access.
10. **All timestamps stored UTC** as `timestamptz`. Displayed in tenant locale.
11. **All money stored as `bigint` minor units** (e.g. paise) + ISO 4217 currency code.
12. **Every request carries `correlationId`.** Propagated to downstream calls + events + logs.
13. **No cross-service or cross-module FKs.** Reference other domains by opaque ID (`"procurement_po:UUID"`), never a foreign key.

---

## 4. Forbidden patterns — PR will be rejected

- `console.log` in production code → use `server.log.info/warn/error`
- `any` typed exports → use precise types from `@civitasone/types`
- Direct DB access from `apps/web` or `apps/mobile` → always through service API
- Mutation in a `GET` handler → use POST / PUT / PATCH / DELETE
- Cross-tenant data access without an explicit support-mode break-glass flag → triggers audit + alert
- `console.error` for handled errors → use `server.log.error({ err }, "...")`
- Raw SQL outside Drizzle migrations
- `JOIN` across service prefixes (L1) **or** across module schemas inside a service (L2)
- A module importing another module's repo/schema, or a service importing another service's repo/schema
- Hardcoded secrets, hardcoded URLs, hardcoded environment values
- Mixing concerns — one Fastify route file = one route group
- Catching errors and silently returning success
- Calling another service from inside a DB transaction (deadlock risk)

---

## 5. Testing rules

- **Unit tests:** `vitest`, co-located as `*.test.ts`
- **Integration tests:** `vitest` + `supertest` against in-memory Fastify
- **E2E tests:** `playwright` against staging
- **Every PR:** must cover happy path + at least one failure path
- **Coverage:** ≥ 80% line coverage on changed code (Turborepo affected slice)
- **No `skip()` or `only()` in committed tests**

---

## 6. Performance rules (Vol 13)

- p95 API latency under 200ms for read endpoints, under 500ms for write endpoints
- **Reads always go through Redis cache first (read-through).** A query handler must consult the cache via `@civitasone/cache` (`getOrLoad`) before touching Postgres, using key convention `{service}:{tenant}:{resource}:{id}`. A direct Postgres read in a query path (cache bypass) is a bug — CI greps for repo reads not wrapped by the cache helper.
- **Writes always go through the queue (CQRS command path).** A route handler must NOT write to Postgres directly. It validates (zod), publishes a command to `@civitasone/queue`, and returns `202 Accepted` with the new id. A background **consumer** applies the write to Postgres via the **transactional outbox**, emits the domain + audit events, then refreshes/invalidates the cache. The only code allowed to `INSERT/UPDATE/DELETE` is the consumer/outbox layer — CI greps for Drizzle writes inside route handlers.
- Read-your-writes: the command handler writes the projected new state to the cache synchronously so the next read is consistent while the DB write settles asynchronously (the queue is the durability guarantee).
- Target: 1,000 TPS sustained, 10M users
- N+1 queries are bugs — use Drizzle relations or batch loaders

---

## 7. Observability rules

- Structured JSON logs only (Fastify default with `pino`)
- `correlationId` field in every log line
- Trace context: every outbound HTTP and queue publish carries trace headers (OpenTelemetry)
- Metrics: `/metrics` exposes Prometheus format
- Every business event also emits a metric counter

---

## 8. Security rules (Vol 4, Vol 5)

- All secrets via `process.env`, sourced from Vault / Secrets Manager — never committed
- JWT verification via `@civitasone/auth` only
- Every input zod-validated
- SQL injection impossible because we only use Drizzle (parameterised) — raw SQL banned in app code
- CSP, HSTS, X-Frame-Options, X-Content-Type-Options enforced by Next.js middleware + Fastify helmet
- Rate limiting at gateway + per-tenant quota at policy-service
- Break-glass / support-mode access logs to audit + alerts SRE

---

## 9. When asked to do something

1. Read the matching workflow prompt in `.claude/prompts/`
2. If the task touches a domain, read the matching skill prompt in `.claude/skills/`
3. Confirm assumptions in the response before writing code
4. Write the smallest correct change — do not refactor unrelated code
5. Add tests in the same PR
6. Run typecheck + lint + tests before declaring done
7. If you change a contract (API, event, schema), update `@civitasone/types` or `@civitasone/events` in the same PR

---

## 10. Repository map

```
civitasone-suite/
├── apps/
│   ├── web/          (Next.js — all server actions go through service APIs)
│   └── mobile/       (Flutter — calls service APIs via Dio)
├── services/         (19 Fastify services, one prefix each)
├── packages/
│   ├── types/        (shared TypeScript types — single source of truth)
│   ├── events/       (event contracts for inter-service messaging)
│   ├── auth/         (JWT verify + RBAC helpers)
│   ├── db/           (Drizzle base + connection helper)
│   └── ui-kit/       (web component library)
├── infra/
│   ├── aws/          (Terraform — modules + per-env)
│   └── onprem/       (Helm + Ansible + K8s manifests)
├── figma-prompts/    (every screen design prompt — design source of truth)
└── .claude/          (this directory — prompts + skills + this file)
```
