# Runbook: crm-service

> Tier 3. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.5% availability, p95 read < 300 ms.

- **Purpose:** stakeholder relationship management — contact/account management with merge/dedup, deal pipeline tracking (stage progression), activity logging, lead scoring (with ml-service integration), custom fields, bulk contact import, and pipeline configuration. Owns `civitas_crm`. PII-heavy (contact details encrypted via `encryptedText()`).

- **Owner / escalation:** primary: CRM Domain Owner. Secondary: SRE.

- **Dependencies:**
  - Own Postgres DB (`civitas_crm`), RLS enabled, tenant-scoped. PII encrypted (email, phone, address).
  - Redis — read-through cache for contact lists, deal pipelines, lead scores.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for contact CRUD/merge/bulk-import, deal CRUD/stage-update, pipeline CRUD, activity CRUD, account create, lead score recalculate; events mirroring all mutations + `crm.case.opened` (triggers helpdesk ticket creation).
  - Cross-service consumed: `ml.prediction.lead_scored` (ml-service provides conversion probability scores for leads).
  - Cross-service produces: `crm.case.opened` (consumed by helpdesk-service to auto-create a support ticket), `crm.lead.created`/`crm.lead.updated` (consumed by ml-service for feature recomputation).

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: deal pipeline velocity, conversion rate by stage, lead score distribution, contact growth rate, activity volume.

- **Common failure modes → action:**
  - *Bulk import failing* → large CSV imports process in batches (1000 contacts per transaction). If a batch fails, check for: duplicate email/phone violating unique constraints, malformed data (invalid email format), or PII encryption failure (key mismatch). Partially imported batches are committed — the import is resumable from the failed batch number.
  - *Lead score not updating* → verify ml-service is healthy and producing `ml.prediction.lead_scored` events. The CRM consumer listens for these events and updates the local lead score. If ml-service is degraded, lead scores remain at their last-computed value (graceful degradation).
  - *Contact merge conflict* → merging two contacts consolidates activities, deals, and history onto the surviving record. If the merge fails, it's usually because both contacts have deals in the same pipeline at the same stage (business rule violation). Resolve manually by moving one deal first.
  - *DLQ on `crm.contact.merge`* → merge is a complex multi-step operation. If it DLQs, do NOT blindly redrive — inspect whether the merge partially completed (check if the source contact was soft-deleted but activities weren't transferred). May require manual data reconciliation.

- **Rollback:** redeploy previous image tag. Contact merges are difficult to reverse (activities are re-parented). If a bad merge occurred, restore from backup for that tenant's data (targeted restore).

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. PII encryption keys must match — verify before bringing the service back online.
