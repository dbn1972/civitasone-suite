# CivitasOne Suite — Architecture

> **Version:** 0.1.0 · **License:** AGPL-3.0
> **Target segments:** Indian Government departments, PSUs, Section-8 companies, cooperatives, and small offices.
> CivitasOne is a modular, event-driven ERP built as a fleet of small, independently deployable services with strict data ownership boundaries.

---

## 1. Overview

CivitasOne is composed of:

- **33 Fastify microservices** (Fastify 4.27, Node 20, TypeScript), each owning a bounded context.
- **A Next.js 14.2 web application** (App Router) as the primary operator console.
- **A Flutter mobile application** for field and citizen-facing use.
- **An edge gateway** (port `8080`) that terminates public traffic, authenticates, and proxies to services.
- **32 PostgreSQL 16 databases** (database-per-service), **Redis 7** (read-through cache), **AWS SQS** (command/event transport), and **Keycloak 24** (OIDC identity provider, RS256).

The system follows a **CQRS + event-driven** style with a **transactional outbox** for reliable event publication and an **inbox** for exactly-once consumption. Every service is isolated at the data layer (its own database), and cross-service coordination happens exclusively through asynchronous events — never through direct database sharing.

Cross-cutting conventions:

- **Money** is represented as `BigInt` **paise** everywhere (no floats for currency).
- **Timestamps** are `timestamptz`.
- **Multi-tenancy** uses a `tenant_id` column plus PostgreSQL Row-Level Security (RLS) in the shared (Pool) tier; a Silo tier offers dedicated databases per tenant.

---

## 2. C4 Level 1 — System Context

```mermaid
C4Context
  title System Context — CivitasOne Suite

  Person(operator, "Department Operator", "Clerk, officer, approver in a govt/PSU office")
  Person(citizen, "Citizen / Field User", "Uses mobile app for RTI, grievances, field data")
  Person(admin, "Tenant Admin", "Configures org, roles, policies")

  System(civitas, "CivitasOne Suite", "Modular event-driven ERP: finance, HRMS, payroll, procurement, workflow, citizen services and more")

  System_Ext(keycloak, "Keycloak 24", "OIDC Identity Provider (RS256)")
  System_Ext(sqs, "AWS SQS", "Command & event message transport")
  System_Ext(email, "Notification Channels", "Email / SMS / push providers")
  System_Ext(banks, "Payment & Banking Rails", "Treasury, disbursement, e-payments")

  Rel(operator, civitas, "Uses via web console", "HTTPS")
  Rel(citizen, civitas, "Uses via mobile app", "HTTPS/JSON")
  Rel(admin, civitas, "Administers", "HTTPS")
  Rel(civitas, keycloak, "Authenticates users, verifies JWTs", "OIDC / JWKS")
  Rel(civitas, sqs, "Publishes/consumes commands & events", "AWS SDK")
  Rel(civitas, email, "Sends notifications", "SMTP/API")
  Rel(civitas, banks, "Initiates payments", "API")
```

---

## 3. C4 Level 2 — Container Diagram

```mermaid
C4Container
  title Container Diagram — CivitasOne Suite

  Person(operator, "Operator")
  Person(citizen, "Citizen / Field User")

  System_Boundary(suite, "CivitasOne Suite") {
    Container(web, "Web Console", "Next.js 14.2 (App Router)", "Operator-facing UI")
    Container(mobile, "Mobile App", "Flutter", "Field & citizen UI")
    Container(gateway, "Edge Gateway", "Fastify proxy :8080", "AuthN, header stripping, routing")

    Container_Boundary(core, "Core ERP Tier") {
      Container(identity, "identity :3001", "Fastify", "Users, roles, sessions")
      Container(tenant, "tenant :3002", "Fastify", "Tenant lifecycle & config")
      Container(finance, "finance :3007", "Fastify", "GL, budget, treasury, payments")
      Container(hrms, "hrms :3012", "Fastify", "Employee, leave, GPF, pension")
      Container(payroll, "payroll :3013", "Fastify", "Salary processing")
    }

    Container_Boundary(domain, "Domain & Supporting Tiers") {
      Container(procurement, "procurement :3008", "Fastify", "Tenders, awards")
      Container(workflow, "workflow :3029", "Fastify", "Approval orchestration")
      Container(citizen_svc, "citizen :3020", "Fastify", "RTI, grievances")
      Container(billing, "billing :3023", "Fastify", "Checkout, invoicing")
      Container(more, "…28 more services", "Fastify", "asset, grant, legal, crm, helpdesk, etc.")
    }

    ContainerDb(pg, "PostgreSQL 16", "32× civitas_<service> DBs", "Database-per-service + RLS")
    ContainerDb(redis, "Redis 7", "Read-through cache", "getOrLoad, delByPrefix")
  }

  System_Ext(keycloak, "Keycloak 24", "OIDC / JWKS")
  System_Ext(sqs, "AWS SQS", "Commands & events")

  Rel(operator, web, "HTTPS")
  Rel(citizen, mobile, "HTTPS")
  Rel(web, gateway, "REST /v1/*", "HTTPS + Bearer JWT")
  Rel(mobile, gateway, "REST /v1/*", "HTTPS + Bearer JWT")
  Rel(gateway, identity, "Proxies", "HTTP + x-service-secret")
  Rel(gateway, finance, "Proxies", "HTTP + x-service-secret")
  Rel(gateway, keycloak, "Verifies JWT via JWKS", "HTTPS")
  Rel(finance, pg, "Owns civitas_finance", "SQL (Drizzle)")
  Rel(finance, redis, "Read-through cache", "RESP")
  Rel(finance, sqs, "Publish/consume", "AWS SDK")
  Rel(workflow, sqs, "Subscribe to events", "AWS SDK")
```

Each service is a peer container: it owns exactly one database, one cache namespace, and one set of SQS topics. The gateway is the only public ingress; internal service-to-service calls (rare, used for synchronous reads) carry an `x-service-secret` header.

---

## 4. CQRS — Command & Event Flow

Writes never touch domain tables directly from the HTTP handler. Instead:

1. An HTTP route **validates** the request body with **zod**.
2. The route **publishes a COMMAND** to an SQS topic named `{service}.{aggregate}.{action}`.
3. A **durable consumer** processes the command **inside a single DB transaction**: it writes domain tables **and** inserts a row into the transactional **OUTBOX** (same transaction — atomic).
4. An **outbox relay** polls undelivered outbox rows and **publishes EVENT topics** named `{service}.{aggregate}.{pastTense}`.
5. **Other services' consumers** subscribe to those events. Each records the message in its **INBOX** via `markProcessed` (`INSERT ... ON CONFLICT DO NOTHING`) for idempotent, exactly-once handling.

```mermaid
sequenceDiagram
  autonumber
  participant Client
  participant Route as HTTP Route (zod)
  participant SQS as SQS (command topic)
  participant Consumer as Command Consumer
  participant DB as PostgreSQL (domain + _outbox)
  participant Relay as Outbox Relay
  participant EBus as SQS (event topic)
  participant Sub as Subscriber (other service)
  participant Inbox as Subscriber _inbox

  Client->>Route: POST /v1/hrms/leave/apply
  Route->>Route: validate(zod)
  Route->>SQS: publish hrms.leave.apply (command)
  Route-->>Client: 202 Accepted (commandId)

  SQS->>Consumer: deliver command
  activate Consumer
  Consumer->>DB: BEGIN
  Consumer->>DB: INSERT leave.leave_request
  Consumer->>DB: INSERT hrms _outbox (hrms.leave.applied)
  Consumer->>DB: COMMIT
  deactivate Consumer

  Relay->>DB: SELECT undelivered outbox rows
  Relay->>EBus: publish hrms.leave.applied (event)
  Relay->>DB: mark outbox row delivered

  EBus->>Sub: deliver hrms.leave.applied
  Sub->>Inbox: markProcessed(msgId) ON CONFLICT DO NOTHING
  alt first time (row inserted)
    Sub->>DB: apply projection / react
  else duplicate (conflict)
    Sub-->>EBus: ack, no-op (exactly-once)
  end
```

Representative topics in use:

| Command topic | Emitted event topic |
|---|---|
| `billing.checkout.verify` | `billing.checkout.verified` |
| `hrms.leave.apply` | `hrms.leave.approved` |
| `finance.budget.create` | `finance.budget.created` |
| `procurement.tender.award` | `procurement.tender.awarded` |
| `citizen.rti.transfer` | `citizen.rti.transferred` |
| `workflow.instance.create` | `workflow.instance.created` |
| `asset.disposal.file_decided` | `asset.disposal.decided` |

Every service declares its topic surface in `src/shared/topics.ts`, which exports a `COMMANDS` object and an `EVENTS` object. This file is the single source of truth for a service's messaging contract.

---

## 5. Database-per-Service Strategy

Each of the 33 services owns exactly one PostgreSQL database, named `civitas_<service>` (32 databases; `queue` is an embedded library and `gateway` is a stateless proxy, so they hold no database of their own). Examples:

- `civitas_identity`, `civitas_finance`, `civitas_hrms`, `civitas_payroll`, `civitas_procurement`, `civitas_workflow`, `civitas_analytics`, …

**No service reads or writes another service's database.** All coordination is via events. This gives:

- **Independent deployability** — schema changes are local to one service.
- **Blast-radius containment** — a bad migration cannot corrupt another domain.
- **Bounded contexts** — each database maps to one aggregate family.

Within a database, a service organizes tables into **per-module PostgreSQL schemas**. For example:

- `civitas_finance` → schemas `gl`, `budget`, `treasury`, `payments`, `org`.
- `civitas_hrms` → schemas `employee`, `leave`, `gpf`, `pension`, `disciplinary`, `claims`, `recruitment`.

Every service database **also** carries two infrastructure schemas:

- `_outbox` — transactional outbox rows awaiting relay publication.
- `_inbox` — dedup ledger for consumed events (exactly-once).

---

## 6. Event-Driven & Outbox Pattern

The **transactional outbox** solves the dual-write problem: writing domain state and publishing an event must be atomic, but a database and a message broker cannot participate in one distributed transaction cheaply.

```mermaid
flowchart LR
  A[Command Consumer] -->|single TX| B[(Domain tables)]
  A -->|single TX| C[(_outbox rows)]
  B -. commit .-> D{COMMIT}
  C -. commit .-> D
  D --> E[Outbox Relay poller]
  E -->|publish EVENT| F[[SQS event topic]]
  E -->|mark delivered| C
  F --> G[Subscriber consumer]
  G -->|markProcessed ON CONFLICT DO NOTHING| H[(_inbox)]
  H -->|first-seen only| I[Apply reaction / projection]
```

- Domain write and outbox insert commit together → the event is **guaranteed** to be recorded if and only if the state change persisted.
- The relay is **at-least-once**: it may re-publish after a crash. Duplicates are harmless because subscribers dedup via `_inbox`.
- The relay is hardened to survive restarts and back off on transient SQS errors, draining the outbox in order.

---

## 7. Multi-Tenancy Model

CivitasOne is single-database-per-service but **multi-tenant within** each database (the **Pool tier**):

- Every tenant-scoped table has a `tenant_id` column.
- **Row-Level Security** is enabled and forced:

  ```sql
  ALTER TABLE leave.leave_request ENABLE ROW LEVEL SECURITY;
  ALTER TABLE leave.leave_request FORCE ROW LEVEL SECURITY;

  CREATE POLICY tenant_isolation ON leave.leave_request
    USING (tenant_id = current_tenant_id());
  ```

- `current_tenant_id()` is a SQL helper that reads the `app.tenant_id` **GUC** (session/transaction setting):

  ```sql
  CREATE FUNCTION current_tenant_id() RETURNS uuid
    LANGUAGE sql STABLE AS
    $$ SELECT current_setting('app.tenant_id', true)::uuid $$;
  ```

- Each request runs inside a **tenant-scoped transaction** that first executes `SET LOCAL app.tenant_id = '<tenant>'`. RLS then transparently filters every query to that tenant — application code cannot accidentally leak across tenants.

For tenants with regulatory isolation requirements, a **Silo tier** provisions a dedicated database per tenant. The application code is identical; only the connection routing differs.

```mermaid
flowchart TD
  R[Incoming request] --> J[Verify JWT -> tenant claim]
  J --> T[Open tenant-scoped TX]
  T --> S[SET LOCAL app.tenant_id]
  S --> Q[Run queries]
  Q --> P{RLS policy: tenant_id = current_tenant_id}
  P -->|match| V[Rows visible]
  P -->|no match| X[Rows invisible]
```

---

## 8. Cache Strategy

CivitasOne uses **read-through caching** via the shared `packages/cache` module:

- `getOrLoad(key, loader, ttl)` — returns the cached value or runs the loader and populates the cache.
- **Key convention:** `{service}:{tenant}:{resource}:{id}` — tenant is embedded so cross-tenant reads can never collide.
- **TTL clamp:** requested TTLs are clamped to the range **1 second – 1 hour** to bound staleness.
- **Invalidation:** writes call `delByPrefix({service}:{tenant}:{resource})` to evict all cached entries for a resource, guaranteeing the next read repopulates from PostgreSQL.

Because the cache is keyed per tenant and invalidated on write, it is safe under RLS: a cache hit for tenant A can never be served to tenant B.

---

## 9. Authentication & Authorization

Identity is centralized in **Keycloak 24** (OIDC, RS256). The gateway is the trust boundary.

```mermaid
sequenceDiagram
  autonumber
  participant U as User (web/mobile)
  participant KC as Keycloak 24
  participant GW as Gateway :8080
  participant SVC as Service (e.g. finance :3007)

  U->>KC: OIDC login (authorization code)
  KC-->>U: RS256 JWT (access token: iss, aud, tenant, roles)
  U->>GW: GET /v1/finance/budget (Authorization: Bearer JWT)
  GW->>KC: Fetch JWKS (cached)
  GW->>GW: Verify signature (RS256), validate iss + aud
  GW->>GW: Strip spoofable internal headers from client
  GW->>SVC: Forward request + x-service-secret + trusted identity headers
  SVC->>SVC: constant-time compare x-service-secret (fail-closed)
  SVC->>SVC: Open tenant-scoped TX (app.tenant_id)
  SVC-->>GW: Response
  GW-->>U: Response
```

Key controls:

- **JWT verification** at the edge: RS256 signature checked against **JWKS**; both `iss` (issuer) and `aud` (audience) are validated.
- **Header stripping**: the gateway removes any client-supplied internal identity headers before forwarding, so a client cannot spoof its tenant or roles.
- **Service-to-service**: internal calls carry `x-service-secret`, compared in **constant time** and **fail-closed** (a missing/incorrect secret is rejected).

---

## 10. Cross-Service Communication Patterns

| Pattern | Transport | When used |
|---|---|---|
| **Async command** | SQS command topic | All state changes (writes). |
| **Async event** | SQS event topic (via outbox relay) | Domain facts broadcast to subscribers. |
| **Synchronous read** | HTTP + `x-service-secret` | Rare, low-latency lookups needing another service's current state. |
| **Cache lookup** | Redis `getOrLoad` | Hot reads, per-tenant keyed. |

The **default and preferred** pattern is asynchronous events. Synchronous inter-service HTTP is deliberately rare, kept behind the service-secret boundary, and never used for writes.

---

## 11. Data-Consistency Guarantees

- **Within a service:** strong consistency. Domain write + outbox insert are one ACID transaction.
- **Across services:** **eventual consistency** via the outbox relay. A subscriber sees an event shortly after the producer commits.
- **Exactly-once effect:** delivery is at-least-once, but the `_inbox` dedup (`markProcessed` → `INSERT ... ON CONFLICT DO NOTHING`) makes reactions **idempotent**, yielding exactly-once *effect* even under redelivery.
- **Ordering:** per-aggregate ordering is preserved by the relay draining the outbox in insertion order.
- **Tenant integrity:** RLS enforces isolation at the database engine level, independent of application correctness.

```mermaid
flowchart LR
  W[Write in service A] -->|ACID| OA[(A domain + _outbox)]
  OA -->|relay, at-least-once| EV[[Event]]
  EV -->|_inbox dedup| RB[Reaction in service B]
  RB -->|ACID| OB[(B domain + _outbox)]
  classDef strong fill:#dff,stroke:#088;
  class OA,OB strong;
```

---

## 12. Technology Summary

| Concern | Technology |
|---|---|
| Service framework | Fastify 4.27 (Node 20, TypeScript) |
| ORM | Drizzle ORM 0.30 |
| Database | PostgreSQL 16 (database-per-service, RLS) |
| Cache | Redis 7 (read-through) |
| Messaging | AWS SQS (commands + events) |
| Identity | Keycloak 24 (OIDC, RS256, JWKS) |
| Logging | pino 8.21 |
| Web | Next.js 14.2 (App Router) |
| Mobile | Flutter |
| Gateway | Fastify edge proxy (`:8080`) |
| Money | `BigInt` paise |
| Time | `timestamptz` |

---

*This document describes the architecture of CivitasOne Suite v0.1.0. For per-service detail see `SERVICES.md`; for data model detail see `DATABASE-SCHEMA.md`.*
