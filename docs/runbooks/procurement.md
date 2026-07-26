# Runbook: procurement-service

> Tier 2 (candidate for Tier 1 promotion). Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% availability, p95 read < 400 ms, tender lifecycle integrity (no double-award, no EMD loss).

- **Purpose:** complete procure-to-pay lifecycle — annual procurement planning, indent/approval, competitive two-bid tendering (GFR 2017 Rule 149–170), GeM/CPPP integration, auction, PO creation/amendment/milestone/closure, GRN (goods receipt), three-way matching (PO-GRN-Invoice), vendor management (empanelment, blacklisting, scorecard, show-cause), EMD/PBG (bid security/performance guarantee) lifecycle, and advance payments. Owns `civitas_procurement`. 20 modules, 28 migrations — one of the most complex domain services.

- **Owner / escalation:** primary: Procurement Domain Owner. Secondary: SRE + Finance Domain Owner (for payment integration). Page on tender-lifecycle DLQ (public tender integrity at stake) or EMD-handling failures (financial liability).

- **Dependencies:**
  - Own Postgres DB (`civitas_procurement`), RLS enabled, tenant-scoped. PII encrypted (vendor bank details, contact info).
  - Redis — read-through cache for vendor lists, PO status, indent approvals, tender metadata.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands across indent, vendor, PO, GEM, GRN, auction, bid, advance, debit-note, tender, EMD/PBG, plan, PO-amendment, vendor-scorecard, show-cause, tender-doc, corrigendum, pre-bid queries, GeM integration.
  - Events: `procurement.grn.accepted` (consumed by stock-service, asset-service, finance-service for 3-way match), `procurement.po.approved` (consumed by analytics, contract).
  - Cross-service: workflow-service (indent/PO/tender approval chains), finance-service (advance payments, bill creation on GRN), estab-service (eOffice file for high-value tenders), notification-service (vendor notifications).
  - External: GeM portal integration (`GEM_API_URL`, circuit-breaker wrapped), CPPP (Central Public Procurement Portal).

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: tender lifecycle funnel (published → bids → evaluated → awarded), PO cycle time, GRN processing rate, three-way match success/mismatch ratio, vendor scorecard distribution, EMD/PBG outstanding amount.
  - Alert: DLQ on `procurement.tender.*` = CRITICAL (public tender integrity); three-way match mismatch rate > 20% = WARN (process issue); GeM circuit breaker open = WARN.

- **Common failure modes → action:**
  - *Tender award stuck* → verify the evaluation workflow completed (tech + financial); check workflow-service for the approval instance. Two-bid tenders require sequential evaluation — financial envelopes cannot open until tech evaluation is final. If the tech-evaluate command failed, investigate the evaluation criteria (may be a data quality issue in bid submissions).
  - *DLQ on `procurement.emd.*`* → EMD operations are financially sensitive (deposits from bidders). Inspect the failed message: common cause is bank account validation failure on refund path. Never redrive without confirming the EMD hasn't already been refunded (check refund idempotency key). Forfeiture commands are even more sensitive — require explicit approval before reprocessing.
  - *Three-way match mismatch (`procurement.grn.accepted` → finance 3-way)* → this is expected business flow (quantity/price variance). Verify the mismatch event reaches finance-service for the debit-note/short-payment workflow. If consistently mismatching, investigate PO amendment not propagating to GRN expectations.
  - *GeM integration failing* → check GeM portal status; the integration is env-gated (`GEM_ENABLED`). Circuit breaker will auto-recover. GeM orders can be manually reconciled if the sync was interrupted — use the `procurement.gem_integration.exchange` command to re-sync.
  - *Vendor blacklisting not propagating* → blacklist status is cached (Redis key `procurement:{tenant}:vendor:{id}`); verify cache invalidation fired after the `vendor.blacklist` consumer processed. If a blacklisted vendor appears in active POs, the PO-creation route validates against blacklist — check if the blacklist event arrived before or after the PO was created.
  - *PO amendment not reflected in GRN expectations* → amendments update the PO version; the GRN creation consumer reads the latest PO version. If there's a race between amendment processing and GRN creation, the three-way match will catch the discrepancy downstream.
  - *High-value indent approval stuck* → large indents require multi-level workflow (per GFR delegation of financial powers). Check workflow-service for the instance; verify each approval level has an assigned officer. Dead instances (> 30 days pending) should be escalated per the delegation hierarchy.

- **Rollback:** redeploy previous image tag. Tender state transitions are irreversible by design (published tenders cannot be un-published per GFR rules). PO amendments are append-only (each amendment creates a new version). Never rollback schema on this service without DBA review.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) verify no tenders were double-awarded by checking the award idempotency constraint; (2) reconcile EMD/PBG outstanding against bank records; (3) confirm GRN → stock-service/asset-service event chain is intact (replay outbox if entries are pending).
