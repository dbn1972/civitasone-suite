# Changelog

All notable changes to the **CivitasOne Suite** are documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.1.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).

Money values throughout the platform are stored as `BigInt` paise; any amount
referenced in these notes is in Indian Rupees unless stated otherwise.

## [Unreleased]

Targeting **0.2.0** — pre-production hardening. Focus areas: tenant-isolation
enforcement, first-class document rendering, directory synchronisation, billing
provisioning, and closing the security backlog before the first production
tenants onboard.

### Added

- **Document rendering engine** — server-side rendering of eOffice notes, pay
  slips, sanction orders, and tender documents to print-ready PDF/A with
  embedded department letterheads, bilingual (Hindi/English) templates, and QR
  verification stamps.
- **SCIM 2.0 provisioning** — `/scim/v2/Users` and `/scim/v2/Groups` endpoints
  on the identity service for automated joiner/mover/leaver sync from Keycloak
  and external IdPs; supports PATCH-based partial updates and soft-deactivation.
- **Billing payment provisioning** — subscription and metered-usage billing for
  edition tiers, invoice generation, and payment-intent hooks for the private,
  MSME, and cooperative editions.
- **RLS enforcement rollout** — row-level-security policies extended from the
  finance and identity services to all 33 services, with a CI policy-coverage
  gate that fails the build when a tenant-scoped table ships without a policy.

### Changed

- Command consumers now assert tenant context from the verified OIDC claim
  before any write, rejecting cross-tenant command replay at the consumer edge.
- Read-through Redis cache keys are namespaced by `tenant_id` to eliminate any
  possibility of cross-tenant cache bleed.
- Outbox relay batches are drained with explicit visibility-timeout renewal to
  survive slow SQS event-topic publishes without duplicate emission.

### Fixed

- Corrected `QUEUE_DRIVER` resolution so the SQS driver is selected in all
  non-test environments instead of silently falling back to the in-memory stub.
- Outbox relay no longer marks an event dispatched until the SQS publish is
  acknowledged, closing a window where events could be lost on relay crash.
- Inbox dedup key now includes the producer service to prevent event-id
  collisions across services sharing a subscriber.

### Security

- MFA step-up now required for break-glass role activation, sanction approvals
  above a configurable threshold, and payroll disbursement release.
- All service-to-service SQS payloads validated against Zod schemas at the
  consumer boundary; malformed messages are quarantined to a DLQ rather than
  retried indefinitely.
- Dependency audit remediation: upgraded transitive packages flagged by
  `npm audit` to clear all high and critical advisories.

## [0.1.0] - 2026-06

Initial public platform release. An AGPL-3.0 ERP suite for Indian Government
departments, PSUs, Section-8/NGO, cooperatives, and small offices, delivered as
a Fastify + Next.js + Flutter monorepo on PostgreSQL 16, Redis 7, AWS SQS, and
Keycloak 24.

### Added

- **33 CQRS microservices** on Fastify 4.27 / Drizzle ORM 0.30 / Node 20,
  grouped by vertical:
  - *Platform & identity* — gateway, identity, tenant, config, notification,
    audit, search.
  - *eOffice & governance* — file, noting, dak (correspondence), workflow,
    document, records.
  - *Human resources* — hrms, payroll, attendance, leave, recruitment,
    training, grievance.
  - *Finance* — finance (GL), budget, procurement, treasury, assets, billing,
    tax.
  - *Operations & citizen* — inventory, service-desk, scheme, citizen-portal,
    reporting, integration, scheduler.
- **CQRS + transactional outbox** — HTTP command → SQS command topic → durable
  consumer → transactional outbox → SQS event topic → subscribers, with inbox
  dedup and at-least-once delivery across every service.
- **Database-per-service** topology with row-level-security tenant isolation on
  the finance and identity cores.
- **eOffice file & noting** — hierarchical file movement, green-note drafting,
  and a tamper-evident hash-chain over noting entries so any retro-edit is
  detectable.
- **7th-CPC payroll engine** — pay-matrix computation, DA/HRA/TA rules,
  allowance and deduction ladders, and a rule-driven income-tax engine with
  Form-16 inputs.
- **Finance engine** — double-entry general ledger, budget appropriation and
  commitment control, and re-appropriation workflows.
- **GFR-2017 e-tendering procurement** — tender publication, bid submission,
  technical/financial evaluation, and award, aligned to General Financial
  Rules 2017.
- **Workflow graph engine** — configurable node/edge workflows with SLA timers,
  escalation, and delegation.
- **Authentication** — Keycloak 24 RS256 OIDC, TOTP-based MFA, and audited
  break-glass access for emergency operations.
- **Offline-first Flutter mobile app** (Android, Flutter 3.3+) with local
  queueing and sync for field and low-connectivity use.
- **MSME / Udyam edition onboarding** and multi-edition support (govt, psu,
  private, ngo, section8, cooperative, small_office).
- **Observability** — Prometheus metrics and Grafana dashboards across all
  services, with structured pino 8.21 logging.
- **Deployment artifacts** — Helm charts and AWS Terraform modules for
  reproducible cluster and cloud provisioning.

### Changed

- Standardised all monetary handling on `BigInt` paise end to end to eliminate
  floating-point drift in ledger and payroll totals.
- Adopted `exactOptionalPropertyTypes` across the TypeScript codebase to make
  optional-vs-undefined semantics explicit at service boundaries.

### Fixed

- Hardened the outbox relay against partial-batch failures so a single failed
  publish no longer stalls the relay loop.
- Resolved Drizzle migration ordering so cold-start bootstrap provisions each
  service database deterministically.

### Security

- Enforced RS256 signature verification and issuer/audience checks on every
  gateway-forwarded request.
- Applied RLS tenant isolation to the identity and finance data stores.
- Recorded an immutable audit trail for all privileged and break-glass actions.

[Unreleased]: https://github.com/civitasone/civitasone/compare/v0.1.0...HEAD
[0.1.0]: https://github.com/civitasone/civitasone/releases/tag/v0.1.0
