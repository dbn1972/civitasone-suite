# SmartTransfer OS — architecture & contract pack C0

> **Status:** M01 "Foundations and frozen contracts" — docs only (contract pack **C0**).
> **Scope delivered here (ST-M01-05):** architecture decision records (ADRs) and the C0 documentation set.
> **Spec:** `SMARTTRANSFER-MASTER-SPEC-v3.md` §4 (domain model), §18 (M01 milestone), §19 (deliverables 7, 8, 12).
> **Baseline verified against:** `origin/main` `9d4fa95e5`. Every `path:line` citation in these docs was re-checked on that commit.

SmartTransfer OS is the Universal Workforce Movement & Allocation Engine for CivitasOne.
It runs government transfer cycles end to end: cycle setup, eligibility, preferences, constraint-based
allocation, approval, signed orders, relieving and joining, and HRMS/Payroll reconciliation. It must also
be sellable **standalone** on top of a licensable **Workforce Core** profile of `hrms-service`
(see [ADR-0023](adr/0023-standalone-packaging.md)).

This pack **freezes contracts only**. No code, migration, event registration, API handler or screen is
delivered by ST-M01-05. The event contracts themselves (`defineContract` in `enforce` mode) are delivered
by **ST-M01-06**; the ledger migrations by ST-M01-07; the `applyPosting` command by ST-M01-09; the
`smarttransfer-service` skeleton by ST-M01-12.

## What is decided vs. open

Only these M00 decisions are **APPROVED** and may be built on (see `smarttransfer/M00/DECISIONS.md` approval log):
`D-ST-01, 02, 03, 04, 10, 19, 22, 23`. Everything that depends on a **PROPOSED** decision is written here as an
explicit **OPEN** item naming the `D-ST` id, and is not treated as decided. The open items are collected in
[`open-items.md`](open-items.md).

## Documents in this pack

| Doc | Spec § | Contents |
|---|---|---|
| [Glossary](glossary.md) | §4 | Canonical term for every domain concept, its owning service and placement kind. |
| [ER diagram](er-diagram.md) | §4 | Mermaid ER model for every §4 entity, grouped by owning service (Workforce Core vs. SmartTransfer). |
| [State machines](state-machines.md) | §4, §10, §18 | Mermaid state diagrams for cycle, request, allocation run, order, relieving, joining and appeal. |
| [API sketch](api-sketch.md) | §4, §9, §10, §11 | Route → zod → command+messageId → 202 → consumer surface, with `requireRole` and jurisdiction scoping. Sketch only. |
| [Event list](event-list.md) | §4, §11, §18 | Every `smarttransfer.*` and `hrms.posting.*` topic with producer, consumers, payload outline, version, and dot-to-dash length (≤45, D-ST-19). |
| [Open items](open-items.md) | — | Everything that depends on a PROPOSED decision, by `D-ST` id. |
| ADRs (below) | §18, §19 | One ADR per APPROVED decision. |

### Architecture Decision Records

| ADR | Decision | Status |
|---|---|---|
| [ADR-0001](adr/0001-post-and-occupancy-owner.md) | Owner of the sanctioned Post and effective-dated Occupancy (D-ST-01) | Accepted |
| [ADR-0002](adr/0002-office-hierarchy-owner.md) | Canonical office/department hierarchy owner (D-ST-02) | Accepted |
| [ADR-0003](adr/0003-cadre-master-owner.md) | Cadre master, employee-cadre link, cadre seniority owner (D-ST-03) | Accepted |
| [ADR-0004](adr/0004-tenancy-topology.md) | Tenancy topology for inter-district / inter-department moves (D-ST-04) | Accepted |
| [ADR-0010](adr/0010-hrms-write-boundary.md) | Write boundary: SmartTransfer never writes HRMS tables (D-ST-10) | Accepted |
| [ADR-0019](adr/0019-event-contract-policy.md) | Event-contract policy: `defineContract` enforce, ≤45-char topics (D-ST-19) | Accepted |
| [ADR-0022](adr/0022-non-node-service-deployment.md) | Deployment shape for a non-Node service (D-ST-22) | Accepted |
| [ADR-0023](adr/0023-standalone-packaging.md) | Standalone packaging & licence boundary (Workforce Core) (D-ST-23) | Accepted |

## Conventions these docs assume

From `CLAUDE.md` §3/§6, `docs/ARCHITECTURE.md` §4–§11 and the house rules in `KIRO-BUILD-PROMPT.md` §4:

- **Write path:** route → `zod` → command with an explicit per-command `messageId` → `202 Accepted` → consumer.
  The consumer runs `markProcessed`, the guarded write and the `audit.event.record` outbox event in one transaction.
- **Reads** go through `getOrLoad`; no cross-service SQL and no cross-service foreign keys.
- **FORCE RLS** on every table; `app.tenant_id` set per transaction.
- **Money** is `bigint` minor units plus an ISO 4217 code (none appears in C0; noted where it will).
- **i18n**: every user-facing string uses `t()` with real `en` and `hi` keys.
- SmartTransfer changes HRMS/Workforce Core **only** through the `applyPosting` command ([ADR-0010](adr/0010-hrms-write-boundary.md)).
