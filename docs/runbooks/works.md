# Runbook: works-service

> Tier 3. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.5% availability, p95 read < 400 ms.

- **Purpose:** public works/infrastructure project management — proposal creation (with DAO finalization, splitting, office/COA mapping), Administrative Approval (AA) and Technical Sanction (TS) lifecycle, Bill of Quantities (BoQ) management, tendering (pre-tender → tender → quotation → award → DAO/DO finalization), execution tracking (scope, progress, photos, issues), billing (Running Account bills with measurement-based claims), physical completion, and work closure with asset handover. Owns `civitas_works`. 8 modules. Manages government infrastructure projects from conception to asset handover per CPWD/PWD rules.

- **Owner / escalation:** primary: Works/PWD Domain Owner. Secondary: SRE + Finance Domain Owner (billing feeds finance GL). Page on award finalization failure or billing DLQ.

- **Dependencies:**
  - Own Postgres DB (`civitas_works`), RLS enabled, tenant-scoped.
  - Redis — read-through cache for proposal/tender status, BoQ summaries, progress dashboards.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for proposal lifecycle (create/update/DAO-finalize/split/map-office/map-COA), AA/TS create/finalize, BoQ CRUD/recapitulate, tender lifecycle (pre-tender/tender/quotation/award/DAO-DO-finalize), execution (scope/progress/photo/issue/close), billing, physical-complete, work-close; events mirroring all mutations.
  - Cross-service produces: `works.asset.handover` (consumed by asset-service — when a works project completes, the built infrastructure becomes a fixed asset in the asset register).
  - Cross-service: finance-service (billing feeds GL entries), procurement-service (tender may link to procurement for material supply), project-service (scheme-to-works linkage).
  - Financial: BoQ amounts and billing claims in BigInt paise. Running Account bills use measurement-based progressive billing.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: works by status (proposal/AA/TS/tender/execution/completed), BoQ variance (estimated vs actual), billing claim processing rate, physical progress vs timeline, asset handover pipeline.
  - Alert: billing DLQ > 0 = WARN (contractor payment stuck); award DAO finalization failure = WARN; physical completion without work-close > 30 days = WARN.

- **Common failure modes → action:**
  - *Proposal DAO finalization failing* → DAO (Drawing and Disbursing Officer) finalization locks the proposal and enables tendering. If failing, check the proposal state (must be in `draft` or `submitted`). If the proposal has incomplete mandatory fields, finalization will reject.
  - *BoQ recapitulation mismatch* → BoQ recapitulation sums line items. If the total doesn't match expectations, verify individual line items (quantity × rate × factor). Rounding is done at the line level (BigInt paise — no floating-point drift).
  - *Award finalization stuck* → award requires two finalizations (DAO + DO). If one is stuck, check the approval workflow. Both must complete before the contractor can begin work.
  - *Running Account billing dispute* → RA bills are measurement-based (inspector measures actual work done). If a bill is disputed, check the measurement records against the BoQ. Discrepancies are normal (field conditions differ from estimate) — the system records the variance.
  - *Asset handover not triggering* → when a work is closed (`works.work.close`), the `works.asset.handover` event creates the asset in asset-service. If the asset isn't appearing, verify the event was published and asset-service's consumer processed it. The work must be in `completed` status with `physicalComplete = true`.
  - *Issue resolution blocking completion* → open issues on a work prevent physical-completion marking. All critical issues must be closed before the work can be marked complete. If non-critical issues are blocking, verify the issue severity classification.
  - *Photo upload for progress failing* → progress photos go to S3/MinIO. Check storage connectivity. Photos are geo-tagged and timestamped (tamper evidence).

- **Rollback:** redeploy previous image tag. Proposals/tenders/awards follow an irreversible state machine (per CPWD rules — you cannot un-award a contract). BoQ edits are versioned.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) verify tender award states are consistent (no double-awards); (2) reconcile billing claims against finance-service GL; (3) check if any asset handover events were lost during the gap (asset-service should have the corresponding asset).
