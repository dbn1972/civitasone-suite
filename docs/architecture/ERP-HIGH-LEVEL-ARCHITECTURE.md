# CivitasOne Suite — High-Level Architecture & Module Integration

**Date:** 2026-06-28
A code-grounded overview of the ERP modules and how they integrate.

---

## 1. Layered view

```mermaid
flowchart TB
  subgraph Clients
    WEB[Next.js 14 Web<br/>apps/web]
    MOB[Flutter Mobile<br/>apps/mobile]
  end

  GW[gateway-service<br/>auth · routing · RequestContext]
  KC[Keycloak 24<br/>OIDC/SAML · RS256 JWT]

  WEB -->|/api/proxy| GW
  MOB -->|HTTPS| GW
  WEB -. OIDC .-> KC
  GW -. JWKS verify .-> KC

  subgraph Services["33 Fastify microservices — one Postgres DB each"]
    direction TB
    CORE[Platform: identity · tenant · policy · audit ·<br/>notification · workflow · admin · billing · install · plugin · theme]
    FIN[Finance: finance · payroll]
    PROC[Procurement: procurement · contract]
    PEOPLE[People: hrms]
    ASSETS[Assets: asset · stock · inventory]
    PROG[Programmes: project · grant]
    SERVDESK[Service: citizen · legal · crm · helpdesk · telephony · knowledge]
    EOFF[eOffice: estab]
    INSIGHT[Insight: report · analytics · location]
  end

  GW --> Services

  subgraph Data["Per-service data + shared infra"]
    PG[(PostgreSQL 16<br/>DB-per-service)]
    RD[(Redis 7<br/>read-through cache)]
    SQS[[AWS SQS<br/>commands + events]]
    S3[(S3 / MinIO)]
    MEILI[(Meilisearch)]
  end

  Services --> PG
  Services --> RD
  Services <--> SQS
  Services --> S3
  Services --> MEILI
```

---

## 2. The integration contract (how services talk)

Three CI-enforced rules govern all inter-module integration:

| Concern | Mechanism |
|---------|-----------|
| **Cross-service READ** | HTTP API (synchronous, via gateway) |
| **Cross-service WRITE** | **SQS** command/event — never a cross-DB write |
| **Within a service WRITE** | CQRS: Route → zod validate → publish command → **202**; Consumer → idempotency → **transactional outbox** → emit event → refresh cache |
| **Every mutation** | emits an **audit event** (`audit.event.record`) to audit-service |
| **Every read** | through Redis `getOrLoad` (key `{service}:{tenant}:{resource}:{id}`) |
| **Every entity** | `id, tenantId, createdAt, updatedAt, createdBy, updatedBy, version` |

```mermaid
flowchart LR
  R[Route handler] -->|zod validate| Q[(SQS command)]
  R -->|202 Accepted| C1[Client]
  Q --> CON[Consumer]
  CON -->|idempotency check| OB[(Transactional outbox)]
  OB --> DB[(Postgres)]
  OB --> EV[(SQS event)]
  CON --> CA[(Redis cache refresh)]
  EV --> AUD[audit-service]
  EV --> OTHER[other services' consumers]
```

Shared building blocks (`packages/*`): `@civitasone/auth` (JWKS + Fastify plugin), `cache`, `db` (Drizzle), `queue` (SQS adapter), `events` (contracts), `outbox`, `schemas` (zod), `observability`, `circuit-breaker`, `types`, **`eoffice-sdk`** (the cross-module approval client).

---

## 3. eOffice as the decision backbone (the integration spine)

estab-service (eOffice) is not a side filing system — it is the **approval control point** between an ERP intent and its execution. Any module raises a file; it routes through the desk hierarchy by amount; the decision flows back to execute.

```mermaid
sequenceDiagram
  participant MOD as Source module<br/>(finance / hr / procurement / grant / asset / legal / contract)
  participant SDK as @civitasone/eoffice-sdk
  participant EST as estab-service (eOffice)
  participant MX as Approval matrix
  participant WF as workflow-service
  participant AUD as audit-service

  MOD->>MOD: entity -> pending_approval (submit-approval)
  MOD->>SDK: raiseFile(refType, refId, amountMinor, ...)
  SDK->>EST: POST /v1/estab/files/from-module (202)
  EST->>MX: resolve approval chain by (module, amount band)
  EST->>WF: create file_noting instance (SO -> US -> DS)
  loop each level approves
    WF-->>EST: estab.file.level_approved
    EST->>EST: auto-sign green note (hash-chained)
  end
  WF-->>EST: estab.file.approve (terminal)
  EST-->>MOD: {module}.{entity}.file_decided  (approved/rejected)
  MOD->>MOD: execute (release budget / issue PO / effect transfer / dispose ...)
  EST->>AUD: audit every step (immutable)
```

**Two-way contract (uniform across modules):**
- **Raise:** `POST /v1/estab/files/from-module` (via `eoffice-sdk`) with `refType`, `refId`, `context.amountMinor`.
- **Decide-back:** estab emits `{module}.{entity}.file_decided`; the module consumes it with `parseDecisionCallback` / `onDecision` and runs the side effect.

**Decision types wired end-to-end (11):**

| Module | source_ref_type | On approval executes |
|--------|-----------------|----------------------|
| finance | `finance_sanction` | sanction approved |
| finance | `finance_payment` | payment released |
| finance | `finance_reappropriation` | budget reMinor updated |
| procurement | `procurement_po` | PO approved/issued |
| hrms | `hr_transfer` | posting effected |
| hrms | `hr_promotion` | designation/pay updated |
| hrms | `hr_disciplinary` | penalty imposed |
| grant | `grant_disbursement` | disbursement initiated |
| asset | `asset_disposal` | asset disposed (+ GL post) |
| legal | `legal_opinion` | opinion issued |
| contract | `contract_award` | contract awarded |

**Supporting eOffice capability:** DAK/receipt diarisation, file operators (division-admin desk enrolment gating who can hold a file), charge handover, paper→electronic migration, DFA outgoing communication (draft→approve→sign→dispatch with enclosures: green note-sheet + DAK + attachments), notifications, and a guided lifecycle wizard.

---

## 4. Other key cross-module flows (examples, all via SQS events)

```mermaid
flowchart LR
  PROC[procurement: GRN accepted] -->|procurement.grn.accepted| FIN[finance: bill/asset]
  PROC -->|asset capitalization| ASSET[asset-service]
  PAY[payroll: run approved] -->|payroll.run.approved| FIN
  GRANT[grant: UC submitted] -->|grant.uc.submitted| FIN
  WF[workflow: task complete] -->|domain dispatch| MANY[hrms/finance/procurement/estab/asset]
  TEN[tenant: created] -->|tenant.tenant.created| WFSEED[workflow seeds definitions]
  TEN --> HRSEED[hrms seeds leave types]
  ANY[every mutation] -->|audit.event.record| AUDIT[audit-service]
  ANY -->|notification.send| NOTIF[notification-service]
```

- **Workflow engine** (`workflow-service`) is the shared approval router: definitions (nodes + edges) per tenant, amount-condition routing, and domain dispatch on terminal completion (`estab.file.approve`, `hrms.leave.approve`, `procurement.po.approve`, …).
- **Reads stay HTTP:** e.g. the eOffice operator picker reads HRMS employees; visiting cards read the tenant registry.
- **Money** is always `bigint` minor units (paise) + ISO currency; **timestamps** UTC; **multi-tenant** isolation on every row (+ RLS).

---

## 5. One-line summary

> A pnpm/Turborepo monorepo of 33 DB-per-service Fastify microservices behind a gateway, integrated by **HTTP for reads and SQS for writes** (CQRS + transactional outbox + read-through cache + universal audit), with **workflow-service** as the approval router and **estab-service (eOffice)** as the cross-module decision backbone that turns every ERP intent into a routed, hash-chained, immutable, auto-executing approval.
