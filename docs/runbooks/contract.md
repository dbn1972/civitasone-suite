# Runbook: contract-service

> Tier 2. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.9% availability, p95 read < 300 ms, renewal alert delivery ≥ 99% (missed renewals = financial/legal exposure).

- **Purpose:** contract lifecycle management — creation from templates with clause libraries, multi-level approval workflows, activation, amendment tracking (version history), obligation monitoring, renewal management with advance alerts, e-signature (DSC/Aadhaar eSign), and expiry alerting. Owns `civitas_contract`. Manages legally binding documents with statutory deadlines.

- **Owner / escalation:** primary: Legal/Procurement Domain Owner. Secondary: SRE. Page on renewal alert failures (missed contract renewals carry financial penalties) or e-sign deadline breaches.

- **Dependencies:**
  - Own Postgres DB (`civitas_contract`), RLS enabled, tenant-scoped.
  - Redis — read-through cache for contract status, clause library lookups, template metadata.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for contract CRUD/approve/activate/close/terminate/amend, rate-contract, clause CRUD, template CRUD, obligation CRUD, renewal, approval-levels, e-sign lifecycle; events for contract state changes, clause/template updates, e-sign completion/escalation, expiry alerts.
  - Cross-service consumed: `estab-service` eOffice decision callback (contract award decisions routed through file noting).
  - Cross-service produces: `contract.contract.activated` (consumed by finance for rate-contract PO linking), `contract.expiry.alert` (consumed by notification-service).
  - External: DSC signing via `@civitasone/render` (PKCS#7 signatures), Aadhaar eSign gateway (env-gated).

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: contracts by status (draft/pending/active/expired/terminated), renewal pipeline (due in 30/60/90 days), obligation compliance rate, e-sign completion rate, amendment frequency.
  - Alert: expiry alert delivery failure = CRITICAL (legal exposure); e-sign deadline approaching with unsigned parties = WARN; obligation compliance < 80% = WARN.

- **Common failure modes → action:**
  - *Renewal alerts not firing* → verify the scheduled `contract.esign.check_deadline` or renewal-check cron is running. Renewals are date-driven — if the scheduler missed a day, manually trigger a renewal sweep for contracts with `renewalDate <= today + 90d`.
  - *E-sign stuck (parties not signing)* → the `esign.check_deadline` command escalates unsigned contracts. If the escalation event isn't being processed, check notification-service health. The e-sign module enforces deadlines — after the configured deadline, the contract moves to `escalated` state automatically.
  - *Contract approval stuck in workflow* → verify the workflow-service instance for this contract. Multi-level approvals (configured via `approval_levels`) require each level to have an assigned approver. If an approver is on leave, check if delegation is configured in workflow-service.
  - *Amendment version conflict* → amendments use optimistic locking (`version` column). If two amendments are attempted simultaneously, one will fail with 409 Conflict. This is correct behavior — the failed amendment must be retried with the latest version.
  - *Template clause rendering failing* → clause templates use mustache-style variable interpolation. If a contract references a clause with undefined variables, the rendering fails gracefully (leaves placeholders). Check the clause-template variable mapping.
  - *Rate-contract linkage to PO not working* → verify the `contract.contract.activated` event was emitted and reached procurement-service. Rate contracts are referenced by procurement when creating POs against pre-negotiated rates.

- **Rollback:** redeploy previous image tag. Contract state is legally significant — never roll back a state transition (an activated contract cannot be un-activated). Amendments are append-only. E-signatures are cryptographically immutable (PKCS#7 signed bytes cannot be reverted).

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) verify no contracts missed their renewal date during the outage — re-run the renewal sweep; (2) confirm e-sign timestamps are intact (DSC signatures embed the signing timestamp); (3) reconcile obligation due dates — any obligations that breached SLA during downtime need manual status correction.
