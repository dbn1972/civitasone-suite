# Runbook: revenue-service

> Tier 3 (newer service — maturing). Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.5% availability, p95 read < 300 ms, assessment accuracy 100% (tax demands are legally binding).

- **Purpose:** municipal/local-body revenue management — rate engine (rate heads, slabs, penalty rules, rebate rules for property tax / water / sewerage / trade licence), assessee management (properties, water connections, etc.), assessment lifecycle (create/revise/remit with maker-checker for remissions), demand generation (billing based on rate engine application), collection management (receipt recording, BBPS integration for online payments), arrears management (penalty computation with interest accrual, aging analysis), and revenue dashboards. Owns `civitas_revenue`. 7 modules. Newer service (2 migrations) — schema still maturing.

- **Owner / escalation:** primary: Revenue/Municipal Domain Owner. Secondary: SRE + Finance Domain Owner. Page on demand generation failure (citizens receive incorrect tax demands) or collection processing failure.

- **Dependencies:**
  - Own Postgres DB (`civitas_revenue`), RLS enabled, tenant-scoped.
  - Redis — read-through cache for rate slabs (frequently queried during demand generation), assessee status, collection receipts.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for rate-head/slab/penalty-rule/rebate-rule create, assessee create/update, assessment create/revise/remit/remit-decide, demand generate, collection receipt, arrears compute; events for assessment lifecycle, demand generated, receipt issued.
  - Financial integrity: all amounts (rate values, assessment base values, demand amounts, collections, arrears) in BigInt paise. Rate slabs support flat/band/ad-valorem types with per-head interest computation (simple/compound).
  - BBPS (Bharat Bill Payment System) integration for online collection (env-gated).
  - Cross-service: finance-service (collections feed into revenue GL), notification-service (demand notices to property owners), citizen-service (self-service payment portal).
  - Maker-checker: assessment remissions (waiving tax) require two-person approval (maker creates, checker approves/rejects via `revenue.assessment.remit_decide`).

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: demand vs collection (gap analysis), arrears aging, collection growth, rate-head wise revenue, remission rate, BBPS transaction success rate.
  - Alert: demand generation failure = WARN (citizens won't receive bills); collection processing DLQ > 0 = CRITICAL (revenue stuck); arrears computation failure = WARN.

- **Common failure modes → action:**
  - *Demand generation incorrect* → demands are computed by applying rate slabs to the assessee's base value. If demands are wrong, check: (1) the rate slab configuration for the applicable head, (2) the assessee's base value (property area, connection size), (3) any applicable exemptions. The computation is deterministic — same inputs always produce same demand.
  - *Arrears penalty calculation drift* → penalties accrue interest (simple or compound) from the due date. If penalty amounts seem wrong, verify: (1) the penalty rule (annual rate in basis points), (2) the grace days (penalty doesn't accrue during grace period), (3) the cap (some rules cap penalty at a percentage of principal). Compound interest compounds annually.
  - *Remission bypass (single-person approval)* → remissions are high-risk (waiving legally owed tax). The maker-checker pattern requires `createdBy ≠ actorId` on the decide command. If a bypass is detected, this is a security incident — escalate to audit.
  - *BBPS collection not recording* → BBPS provides payment confirmations via callback. If callbacks aren't being processed, check the BBPS adapter connectivity and webhook registration. Collections can be manually recorded as a fallback.
  - *Rate slab effective-date conflict* → rate slabs have `effectiveFrom` / `effectiveTo` dates. If two slabs for the same head overlap in time, demand generation may produce unpredictable results. Verify no overlapping slabs exist for the same rate head.
  - *Assessment revision audit trail* → every revision creates a new version with the reason. If revisions are happening without proper justification, check the audit trail. Revisions are visible in the assessment history for transparency.

- **Rollback:** redeploy previous image tag. Assessments and collections are append-only (legally binding records). Demands once issued cannot be withdrawn (only revised with a new assessment).

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) verify no duplicate demand notices were generated (idempotency on assessment ID + financial year); (2) reconcile collections against payment gateway records (BBPS/bank); (3) re-compute arrears from restored assessment and collection data.
