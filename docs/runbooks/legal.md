# Runbook: legal-service

> Tier 2. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% availability, p95 read < 300 ms, limitation tracking accuracy 100% (missed limitation = case barred by time).

- **Purpose:** legal case management — case creation/tracking, hearing scheduling/adjournment, court order recording, legal notice management, contract review/clearance, settlement tracking, opinion drafting/issuance (with eOffice approval), counsel brief assignment, filing records, statutory limitation tracking (Limitation Act 1963), document management with legal holds, RTI compliance, and e-Courts integration. Owns `civitas_legal`. 16 modules handling statutory deadline-sensitive data.

- **Owner / escalation:** primary: Legal Domain Owner. Secondary: SRE. Page on limitation tracking failures (a missed limitation period = case permanently barred, unrecoverable legal loss).

- **Dependencies:**
  - Own Postgres DB (`civitas_legal`), RLS enabled, tenant-scoped.
  - Redis — read-through cache for case status, hearing dates, limitation countdown.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for case CRUD, hearing create/adjourn, order record, notice create/respond, contract-review, settlement, opinion lifecycle, counsel-brief, filing, reminder, document CRUD/hold, limitation CRUD, RTI lifecycle; events for case date set, opinion issued, filing recorded, RTI responded/transferred.
  - Cross-service consumed: `legal.opinion.file_decided` (estab-service eOffice callback for legal opinion approval), `meeting.decision.legal` (meeting-service board decisions with legal implications — triggers triage intake).
  - Cross-service produces: `legal.case.date_set` (consumed by notification-service for hearing reminders), `legal.contract_review.cleared` (consumed by contract-service to unblock contract activation).
  - External: e-Courts portal integration (env-gated, circuit-breaker wrapped) for case status synchronization.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: cases by status, hearing calendar (upcoming 7/30 days), limitation expiry countdown (due in 30/60/90 days), opinion turnaround time, contract-review clearance SLA, RTI compliance rate.
  - Alert: limitation expiry in < 7 days with no action = CRITICAL (page immediately); hearing date missed (no adjournment/outcome recorded) = WARN; e-Courts sync failure = WARN.

- **Common failure modes → action:**
  - *Limitation tracking alert not firing* → verify the limitation sweep scheduled job is running (checks `expiresAt` against current date). If the scheduler missed a cycle, manually trigger `legal.reminder.create` for all limitations expiring in the next 30 days. This is the most critical alert in the service — missed limitations cannot be recovered.
  - *Hearing adjournment not recording* → verify the `legal.hearing.adjourn` consumer processed the message. Common cause: optimistic lock conflict (hearing was simultaneously updated by e-Courts sync). Retry with the latest version.
  - *Legal opinion stuck in approval* → opinions route through estab-service eOffice file noting. Check the consumed event `legal.opinion.file_decided` — if the file was decided but the event wasn't received, check estab-service outbox relay. If the file is still pending, this is a business process issue (approver hasn't acted).
  - *Board-intake triage items accumulating* → `meeting.decision.legal` events create triage items. If these pile up, it means the legal team hasn't processed them. This is business-normal (not a system failure) — but if the consumer itself is failing, check DLQ.
  - *Document hold not preventing deletion* → legal holds set a `holdApplied` flag on documents. If a document with an active hold is being deleted, the route-level validation should reject it (403). If it's getting through, check if the hold was applied to the correct document ID.
  - *e-Courts sync failing* → external portal may be down; circuit breaker handles this. Sync is informational (enriches local case data with court updates) — not blocking for core operations. Log WARN and let it auto-recover.
  - *RTI response approaching 30-day deadline* → this is a statutory deadline (RTI Act 2005). The SLA sweep should escalate. If escalation isn't happening, verify the `legal.rti.*` SLA check commands are firing.

- **Rollback:** redeploy previous image tag. Legal data is immutable (court orders, filings, notices cannot be altered once recorded). Limitation dates are computed at creation — they survive rollback.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) immediately run the limitation sweep — any limitations that expired during downtime need urgent attention; (2) verify hearing dates haven't been missed (cross-reference with court calendar); (3) confirm legal holds are intact (no documents were accidentally purged during the gap).
