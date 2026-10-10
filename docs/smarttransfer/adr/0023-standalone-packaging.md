# ADR-0023: Standalone packaging and licence boundary (Workforce Core)

- **Status:** Accepted
- **Decision id:** D-ST-23 (APPROVED, approval log 2026-10-09)
- **Date:** 2026-10-09
- **Deciders:** programme owner dbn1972 with HR domain owner (approved)
- **Spec:** §0 (sellable standalone); §3 (modes A–E); §18 M01
- **Related:** [ADR-0001](0001-post-and-occupancy-owner.md), [ADR-0002](0002-office-hierarchy-owner.md),
  [ADR-0003](0003-cadre-master-owner.md), [ADR-0010](0010-hrms-write-boundary.md); source
  `smarttransfer/M00/standalone/STANDALONE-FEASIBILITY.md`; delivered by ST-M01-02, 03, 04 (gating/catalogue/profile)

## Context

SmartTransfer must be sellable to a customer who does **not** buy full HRMS (spec §0). The boot test proved the platform
shell runs without HRMS (STANDALONE §1, §7). But a Workforce Core + SmartTransfer tenant is **not yet provisionable**:
the module catalogues cannot name either module, module enablement is split across stores that disagree, and the gateway
guard **fails open** on unmapped routes, missing tenant, and admin outage (`gateway-service/src/module-guard.ts:105,108,166-170`,
verified on `origin/main` `9d4fa95e5`). Two of the four Workforce Core entities (posting ledger, post/occupancy) **do
not exist** and are BUILD under every option (STANDALONE §4).

Three packaging options were weighed (STANDALONE §4): (a) a module profile of `hrms-service`; (b) a new
`workforce-core` service (3–5 engineer-months, regresses every HRMS tenant); (c) a shared package (code boundary only,
not a licence boundary).

## Decision

**Workforce Core is a separately licensable module profile of `hrms-service`, and SmartTransfer is its own SKU**
(option (a), shaped so it can later become a shared package (c)).

- Workforce Core = employee basics, posting ledger & tenure, office hierarchy, sanctioned post / occupancy / vacancy.
  Its **new** tables (`post`, `post_occupancy`, `posting_ledger`, `cadre`) live in **their own schema and module folder**
  so they are liftable to a package later (ST-M01-07; [ADR-0001](0001-post-and-occupancy-owner.md)).
- Enablement prerequisites (STANDALONE §5), delivered by ST-M01-02/03/04:
  1. **Composition is the single source of truth**; the tenant-admin toggle writes it.
  2. Catalogue rows `workforce_core` (deps org, config) and `smarttransfer` (deps workforce_core, workflow, audit), a
     `smarttransfer_standalone` bundle/profile, and a plan-to-composition applier.
  3. The guard **fails closed** for any non-platform route in both modes; platform keys (documents, notification,
     reports, identity, audit) are added to the composition projection.
  4. Sub-route gateway keys so the `hrms` key no longer unlocks leave/payroll/recruitment/pension.
  5. `smarttransfer-service` and `hrms-service` **re-check their own entitlement** in-service (defence in depth).
- **Mode B** (external HRMS) adapter is **optional**; its import target (Workforce Core departments vs. `tenant.org_units`
  mapping) is settled with [ADR-0002](0002-office-hierarchy-owner.md).

## Consequences

- `D-ST-01/02/03` are owned by **Workforce Core** (reflected in those ADRs).
- The licensing layer — not the Workforce Core extraction — is the real standalone blocker (STANDALONE §1): ST-M01-02/03/04
  must land before a standalone tenant can be provisioned.
- **M01 exit criterion:** a tenant provisioned as `smarttransfer_standalone` boots with **no** payroll/leave/recruitment
  APIs or screens reachable, proven by a cross-tenant gating test (`KIRO-BUILD-PROMPT.md` §3 exit criterion 3).
- A core-only customer still carries the mostly-empty full HRMS schema (239 tables) and needs `PII_ENC_KEY` at first
  employee write (STANDALONE §3, §5 S13); accepted residual.

## Alternatives considered

- **(b) New `workforce-core` service** — rejected: 3–5 engineer-months and regresses every existing HRMS tenant
  (13 FKs point into employees; ~45–85 files read `hrms_employees` directly) (STANDALONE §4).
- **(c) Shared package only** — deferred: a code boundary, not a licence boundary; adopt after the post model exists.
