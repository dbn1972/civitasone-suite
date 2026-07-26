# Runbook: court-service

> Tier 2. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% availability, p95 read < 300 ms, cause-list generation reliability 100% (courts operate on strict daily schedules).

- **Purpose:** full court/tribunal case management — case registration (CNR-based), case lifecycle transitions, hearing scheduling/adjournment/outcome recording, order/judgment recording, filing submission with scrutiny/defect management, cause-list generation (daily court scheduling), notice issuance/service-of-process, compliance/direction monitoring, appeal/revision/review lifecycle, evidence management, party management, certified copy issuance, and public case lookup. Owns `civitas_court`. 19 modules — mirrors the Indian judiciary's operational workflow.

- **Owner / escalation:** primary: Judiciary/Court Domain Owner. Secondary: SRE. Page on cause-list generation failure (courts cannot function without the daily list) or hearing-related DLQ entries.

- **Dependencies:**
  - Own Postgres DB (`civitas_court`), RLS enabled, tenant-scoped. PII encrypted (party details — litigant names, addresses, advocate info).
  - Redis — read-through cache for case status, hearing schedules, cause-list, case-parcel (grouping related cases).
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for case register/status-update, hearing schedule/adjourn/outcome, order record, filing submit, cause-list generate/list-case, scrutiny record/resolve, defect raise/resolve, notice issue/serve/status, compliance direct/update, appeal file/register/decide/withdraw; events for case registered/status-changed, hearing scheduled/adjourned/outcome, order recorded, filing submitted, cause-list generated, scrutiny resolved, notice issued/served, compliance directed/updated, appeal filed/decided.
  - Cross-service: analytics-service (consumes `court.case.registered`, `court.case.status_changed`, `court.hearing.scheduled` for judiciary dashboards), notification-service (hearing reminders, notice service confirmations).
  - External: e-Courts (National Judicial Data Grid) integration for case status sync.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: cases by status (pending/hearing/reserved/disposed), daily cause-list size, hearing outcomes distribution, filing scrutiny pass/fail rate, compliance monitoring (overdue directions), appeal pipeline.
  - Alert: cause-list generation failure for any court = CRITICAL (daily operations blocked); hearing outcome not recorded within 24h of scheduled hearing = WARN; compliance direction overdue > 30 days = WARN.

- **Common failure modes → action:**
  - *Cause-list generation failed* → this runs daily (usually overnight via scheduled job `court.causelist.generate`). Check the consumer for errors; common cause: a case-parcel conflict (case linked to two hearings on same day). Resolve the scheduling conflict and re-trigger generation. Courts need the list by 9 AM — this is time-critical.
  - *Hearing adjournment not reflecting in cause-list* → adjournments remove a case from the current day's list and schedule a new date. If the cause-list was already generated before the adjournment, it's stale. Re-generate the cause-list for the affected court/date.
  - *Filing scrutiny stuck (defects not resolving)* → scrutiny is a manual process (registry staff review filings). If the system shows defects as unresolved, verify the `court.defect.resolve` command was received. If the defect was resolved outside the system, manually update via admin API.
  - *Notice service-of-process not tracking* → notice service requires recording delivery (bailiff/post/electronic). If `court.notice.serve` commands aren't being published, check the notice management UI — this is typically a data-entry gap, not a system failure.
  - *Appeal registration failing* → appeals reference a parent case. If the parent case doesn't exist in this tenant (transferred from another jurisdiction), the consumer will fail. Verify the parent case CNR exists; if it's cross-jurisdictional, the case may need manual registration first.
  - *Case status transition rejected* → case lifecycle follows a strict state machine (pending → hearing → reserved → disposed). Invalid transitions are rejected by domain logic. If a valid transition is being rejected, check the expected `version` in the command payload (optimistic locking).
  - *DLQ on compliance monitoring* → compliance directions have due dates. The sweep identifies overdue directions and escalates. If the sweep consumer itself is failing, it's usually a data quality issue (direction without a due date). Fix the data and redrive.

- **Rollback:** redeploy previous image tag. Case records and orders are legally immutable — never alter after recording. Cause-list generation is idempotent (regenerating for the same date replaces the previous list).

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) immediately regenerate today's cause-list (it may have been lost); (2) verify hearing outcomes for hearings that occurred during downtime — these need manual entry; (3) confirm filing sequence numbers are intact (filings use a sequential counter per court per year — gaps are acceptable but duplicates are not).
