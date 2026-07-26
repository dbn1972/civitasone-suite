# Runbook: helpdesk-service

> Tier 3. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.5% availability, p95 read < 300 ms, SLA breach rate < 5%.

- **Purpose:** internal IT/support helpdesk — ticket lifecycle (create/assign/transition/escalate), SLA engine with breach detection, service catalogue (self-service request fulfilment with multi-stage workflows), automation rules, CMDB (configuration management database), and ml-breach-risk integration for proactive SLA management. Owns `civitas_helpdesk`.

- **Owner / escalation:** primary: IT/Support Domain Owner. Secondary: SRE. Page on SLA engine failure (support commitments at risk).

- **Dependencies:**
  - Own Postgres DB (`civitas_helpdesk`), RLS enabled, tenant-scoped.
  - Redis — read-through cache for ticket lists, SLA timers, catalogue items.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for ticket create/assign/transition; events for ticket lifecycle + service request lifecycle (raised/approved/rejected/stage-advanced/fulfilled/breach-escalated).
  - Cross-service consumed: `telephony.call.missed` (auto-creates callback-request ticket), `crm.case.opened` (auto-creates linked support ticket), `ml.prediction.breach_risk_high` (proactive SLA intervention when breach probability > 0.70), `citizen.request.created` (citizen service requests create department-side helpdesk tickets).
  - Cross-service produces: `helpdesk.ticket.created`/`updated`/`escalated` (consumed by notification-service for agent alerts).

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: ticket volume by priority, SLA compliance rate, mean resolution time, agent utilization, service-request fulfilment rate, breach-risk prediction accuracy.
  - Alert: SLA engine sweep failure = CRITICAL; breach rate > 5% = WARN, > 15% = CRITICAL; ticket backlog > 100 unassigned = WARN.

- **Common failure modes → action:**
  - *SLA engine not computing* → the SLA sweep runs periodically to check ticket timers against configured SLA policies. If sweep stops, tickets won't auto-escalate on breach. Verify the sweep scheduled job is active; manually trigger `helpdesk.ticket.transition` with escalation if tickets are past SLA.
  - *Auto-ticket from telephony not creating* → verify the `telephony.call.missed` consumer is healthy. Check if the missed-call event payload contains the required fields (caller number, queue ID). The ticket is created with source=`telephony` for traceability.
  - *Service request stuck at stage* → multi-stage requests (e.g., "request laptop" → approve → procure → deliver) advance via the `helpdesk.request.stage_advanced` event. If stuck, check workflow-service for the approval instance at that stage. May be pending an approver action.
  - *ML breach-risk consumer failing* → graceful degradation: if ml-service is down, breach prediction simply stops. Tickets still have their static SLA timers. This is non-blocking.
  - *Citizen request not creating helpdesk ticket* → verify the `citizen.request.created` consumer is processing. The consumer maps citizen requests to internal helpdesk tickets for department handling.

- **Rollback:** redeploy previous image tag. Ticket state transitions are logged in history (append-only) — rollback doesn't revert ticket states.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: run the SLA sweep immediately to recalculate breach timers for any tickets that were created during the outage.
