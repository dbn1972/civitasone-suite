# CivitasOne Suite — Low-Level Platform Architecture

## Overview

CivitasOne is a **multi-tenant government ERP** built as a CQRS/event-driven microservices platform. It runs 33 domain services + 31 async workers behind a single API gateway, with a Next.js web app and a Flutter mobile app as clients.

---

## System Topology

```
                           ┌─────────────────────────┐
                           │       CLIENTS            │
                           │  Web (Next.js :3000)     │
                           │  Mobile (Flutter)        │
                           │  Public (/careers)       │
                           └────────────┬────────────┘
                                        │
                           ┌────────────▼────────────┐
                           │   GATEWAY SERVICE :8080  │
                           │  • JWT auth (RS256/HS256)│
                           │  • Prefix→upstream proxy │
                           │  • Module-guard (403)    │
                           │  • PUBLIC_PREFIXES bypass│
                           └────────────┬────────────┘
                                        │
              ┌─────────────────────────┼─────────────────────────┐
              ▼                         ▼                         ▼
   ┌───────────────────┐   ┌───────────────────┐   ┌───────────────────┐
   │  PLATFORM SERVICES│   │   DOMAIN SERVICES  │   │  SUPPORT SERVICES │
   │  identity   :3001 │   │  finance     :3007 │   │  notification:3006│
   │  tenant     :3002 │   │  procurement :3008 │   │  report      :3016│
   │  policy     :3003 │   │  contract    :3009 │   │  plugin      :3017│
   │  audit      :3004 │   │  estab       :3010 │   │  theme       :3018│
   │  install    :3005 │   │  stock       :3011 │   │  analytics   :3031│
   │  admin      :3022 │   │  hrms        :3012 │   │  knowledge   :3028│
   │  billing    :3023 │   │  payroll     :3013 │   │  workflow     :3029│
   │                   │   │  project     :3014 │   │  queue-svc   :3030│
   │                   │   │  asset       :3015 │   │                   │
   │                   │   │  grant       :3019 │   │                   │
   │                   │   │  citizen     :3020 │   │                   │
   │                   │   │  legal       :3021 │   │                   │
   │                   │   │  crm         :3024 │   │                   │
   │                   │   │  inventory   :3025 │   │                   │
   │                   │   │  telephony   :3026 │   │                   │
   │                   │   │  helpdesk    :3027 │   │                   │
   │                   │   │  location    :4012 │   │                   │
   └───────────────────┘   └───────────────────┘   └───────────────────┘
              │                         │                         │
              └─────────────────────────┼─────────────────────────┘
                                        ▼
              ┌─────────────────────────────────────────────────────┐
              │              ASYNC / CQRS LAYER                      │
              │  SQS (LocalStack :4566 dev / AWS prod)              │
              │  • Command queues per service topic                  │
              │  • Dead-letter after 3 retries                       │
              │  • 31 Workers (one per service)                      │
              │  • Inbox dedup (messageId → _inbox.processed)        │
              │  • Outbox relay (_outbox.messages → SQS events)      │
              └──────────────────────┬──────────────────────────────┘
                                     │
              ┌──────────────────────▼──────────────────────────────┐
              │                  DATA LAYER                          │
              │  PostgreSQL 16 (:5435)    Redis 7 (:6381)            │
              │  • 31 databases           • Read-through cache       │
              │  • Per-svc schemas        • Sessions                 │
              │  • RLS (tenant_id)        • Rate limiting            │
              │  • Drizzle ORM            • Negative caching         │
              │  • Per-svc DB users                                  │
              │                                                     │
              │  S3 (LocalStack :4566)    Keycloak (:8180)           │
              │  • Documents/resumes      • OIDC RS256 JWT           │
              │  • Bucket: civitasone     • Realm: civitasone        │
              └─────────────────────────────────────────────────────┘
```

---

## Technology Stack

| Layer | Technology |
| --- | --- |
| Runtime | Node.js 20 |
| Framework | Fastify 4.x |
| ORM | Drizzle ORM (pg-core) |
| Database | PostgreSQL 16 (31 databases) |
| Cache | Redis 7 |
| Queue | AWS SQS (LocalStack dev) |
| Object Storage | AWS S3 (LocalStack dev) |
| Auth | Keycloak (RS256 OIDC) |
| Web App | Next.js 14 (App Router, React 18) |
| Mobile | Flutter 3.3+ (Dart, offline-first) |
| Design System | Custom @civitasone/ui-kit |
| Monorepo | pnpm workspaces + Turborepo |
| Process Mgr | PM2 (65 processes) |
| Infra (dev) | Docker Compose (Postgres, Redis, LocalStack, Keycloak) |

---

## CQRS / Event-Driven Flow

```
WRITE PATH:
  Client → Gateway → Service route handler
    → Validate (Zod) → Publish COMMAND to SQS → Return 202 Accepted
    → Cache: write projected view (optimistic)

  Worker (subscribes to command queue):
    → Receive message → Check _inbox.processed (dedup)
    → DB transaction: { insert domain row + markProcessed + enqueue outbox events }
    → Outbox relay: poll _outbox.messages → publish EVENTS to SQS
    → Cross-service consumers receive events

READ PATH:
  Client → Gateway → Service route handler
    → Check Redis cache (TTL 30-300s)
    → Cache miss → Query Postgres → Store in cache → Return 200
```

---

## Service Port Map (33 services)

| Service | Port | Domain |
| --- | --- | --- |
| identity | 3001 | Users, authentication, device trust, MFA |
| tenant | 3002 | Tenant lifecycle, onboarding, profiles |
| policy | 3003 | RBAC policies, permission evaluation |
| audit | 3004 | Audit trail, compliance events |
| install | 3005 | Tenant provisioning orchestrator |
| notification | 3006 | Email, SMS, push, in-app alerts |
| finance | 3007 | GL, budget, bills, payments, treasury, UCs |
| procurement | 3008 | Indents, RFQ, tenders, POs, GRN, vendors |
| contract | 3009 | Rate contracts, service contracts |
| estab | 3010 | eOffice files, DAK, meetings, fleet |
| stock | 3011 | SKU ledger, stock movements, low-stock alerts |
| hrms | 3012 | Employees, leave, attendance, recruitment, org-chart |
| payroll | 3013 | Salary runs, GPF/NPS, tax, pay structures |
| project | 3014 | DPR, milestones, fund releases, WBS |
| asset | 3015 | Fixed assets, depreciation, maintenance |
| report | 3016 | Scheduled reports, MIS, KPIs |
| plugin | 3017 | Extension marketplace |
| theme | 3018 | Tenant-level branding tokens |
| grant | 3019 | Schemes, grantees, disbursements, UCs |
| citizen | 3020 | RTI, grievances, service requests, portal |
| legal | 3021 | Cases, hearings, court orders, opinions |
| admin | 3022 | Platform admin, module config, operations |
| billing | 3023 | Subscriptions, invoices, Razorpay, dunning |
| crm | 3024 | Contacts, deals, pipeline, activities |
| inventory | 3025 | Warehouse items, transfers |
| telephony | 3026 | Call logs, IVR integration |
| helpdesk | 3027 | Internal IT tickets, SLA tracking |
| knowledge | 3028 | Document management, search |
| workflow | 3029 | Maker-checker, approval chains, BPM |
| queue-service | 3030 | SQS adapter, DLQ management |
| analytics | 3031 | Dashboards, fact events, activation funnel |
| location | 4012 | Office/branch hierarchy, LGD codes |
| **gateway** | **8080** | API proxy, auth, module-guard |
| **web** | **3000** | Next.js frontend (SSR) |

---

## Shared Packages (12)

| Package | Purpose |
| --- | --- |
| auth | JWT verify (RS256+HS256), authPlugin, RBAC helpers |
| cache | Redis read-through, invalidation, negative caching |
| circuit-breaker | Failure threshold → open → half-open → close |
| client-core | OIDC PKCE helpers for web/mobile |
| db | Drizzle utilities, createSqlClient, withTenantScope, RLS GUC |
| events | Domain event type definitions |
| observability | Health/ready/metrics routes, structured logging |
| outbox | Transactional outbox: enqueue in tx → relay to SQS |
| queue | SQS adapter: publish, subscribe, DLQ, dedup inbox |
| schemas | Zod validators (common + per-domain + web response) |
| types | Shared TypeScript types (RequestContext, entities) |
| ui-kit | Design tokens CSS + component primitives |

---

## Database Architecture

- **One database per service** (31 databases in one Postgres cluster)
- **Per-service schema namespaces** (e.g. payments.finance_bills, budget.allocations, gl.journal_entries)
- **Standard tables per service**: domain + `_inbox.processed` (dedup) + `_outbox.messages` (relay)
- **RLS**: `current_tenant_id()` GUC + per-table USING policies
- **Migrations**: plain SQL in services/<svc>/migrations/, idempotent (IF NOT EXISTS)
- **Per-service credentials**: production uses dedicated least-privilege DB users

---

## Security Architecture

| Layer | Mechanism |
| --- | --- |
| Edge auth | Gateway verifies JWT before proxying |
| Service auth | @civitasone/auth plugin on every request |
| Tenant isolation | JWT tid → RLS GUC → per-row enforcement |
| RBAC | policy-service, requireRole() per route |
| Service-to-service | x-internal + INTERNAL_SERVICE_SECRET |
| PII at-rest | AES-256-GCM (PAN, Aadhaar, bank, MFA TOTP) |
| Secrets | Injected from secret manager; fail-closed in prod |
| Audit | Every write → audit event → immutable trail |
| Module guard | Gateway rejects disabled-module requests (403) |

---

## Infrastructure (Docker Compose)

| Container | Port | Purpose |
| --- | --- | --- |
| civitasone-postgres | 5435 | PostgreSQL 16 (31 DBs) |
| civitasone-redis | 6381 | Redis 7 (cache + sessions) |
| civitasone-localstack | 4566 | SQS + S3 + Secrets Manager |
| civitasone-keycloak | 8180 | Keycloak OIDC IdP |

---

## PM2 Process Count

| Type | Count |
| --- | --- |
| HTTP services | 33 |
| Async workers | 31 |
| Web (Next.js) | 1 |
| **Total** | **65** |

---

## Key Design Decisions

1. **One service = one DB** — physical isolation, stronger blast radius
2. **CQRS everywhere** — writes async (202), reads cache-first, natural horizontal scaling
3. **Outbox pattern** — guarantees event delivery even if SQS is temporarily down
4. **Drizzle ORM** — full TypeScript safety from schema to response
5. **Gateway = auth + routing + module-guard** — services trust req.ctx, never re-verify
6. **Multi-tenant by construction** — tenant_id on every row, RLS enforced, audit on every write
