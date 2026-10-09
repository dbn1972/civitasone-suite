# ADR-0004: Tenancy topology for inter-district / inter-department moves

- **Status:** Accepted
- **Decision id:** D-ST-04 (APPROVED, approval log 2026-10-09)
- **Date:** 2026-10-09
- **Deciders:** programme owner dbn1972 with Security owner (approved)
- **Spec:** §3 (product modes); §14 (security); §P08 (security & isolation by design); §18 M01
- **Related:** [ADR-0010](0010-hrms-write-boundary.md)

## Context

CivitasOne is multi-tenant with per-tenant **Row-Level Security**: every tenant-scoped table has `tenant_id`, FORCE RLS,
and `app.tenant_id` set per transaction (docs/ARCHITECTURE.md §7; M00 §1.9). There is **no cross-tenant record handoff**:
`tenant-service` federation explicitly says state views use projections, never child OLTP (`federation.ts:2-10`,
verified on `origin/main` `9d4fa95e5`).

A transfer cycle moves employees between districts and departments. If each district were its own tenant, a transfer
would need a cross-tenant record handoff that does not exist and would be a large security build.

## Decision

**One tenant per cycle-owning authority** (for example, the state government). Districts and departments are modelled as
**org-unit / jurisdiction scopes within that one tenant**, not as separate tenants.

- Inter-district and inter-department moves happen **inside one tenant**, so RLS and the existing isolation model are
  unchanged.
- Jurisdiction scoping (who can see/act on which records) is enforced **inside SmartTransfer queries**, derived from the
  server context, because gateway ABAC is off by default and org claims are not minted today (M00 §8.1; D-ST-11 is
  PROPOSED — see [open-items.md](../open-items.md)).
- **Federated district tenants** with a cross-tenant handoff protocol are **deferred**. A state→district federated
  rollout **cannot** use SmartTransfer until that protocol exists; this limitation is recorded, not silently assumed
  away.

## Consequences

- No new cross-tenant data path is built in M01; the RLS/isolation posture is preserved and testable (ST-M01-15 adds
  cross-tenant tests for the new tables).
- Jurisdiction isolation becomes a **SmartTransfer-level** responsibility (record-level checks in service), not a
  gateway responsibility (M00 §8.1).
- A customer that runs genuinely federated district tenants is out of scope for v1; this is a sales/deployment
  constraint to communicate.

## Alternatives considered

- **(b) Federated district tenants + a new handoff protocol** — deferred to a later milestone; too large and
  security-sensitive for M01, and not required by the single-authority cycle model.
