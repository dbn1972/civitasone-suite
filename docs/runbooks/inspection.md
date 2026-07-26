# Runbook: inspection-service

> Tier 3. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.5% availability, p95 read < 400 ms, mobile sync (offline inspection) reliability 100%.

- **Purpose:** regulatory inspection management — universe management (entities subject to inspection: establishments, shops, factories, etc.), inspection-type configuration with regulatory basis, risk-based inspection planning (risk scoring → prioritized calendar), checklist management (configurable per inspection-type), inspector assignment (competency-based + geographic), field execution (offline-capable mobile workflow), findings recording (with evidence: photos, documents), CAPA (Corrective and Preventive Action) management, enforcement action lifecycle, licence/permit management, survey tools, telemetry (inspector GPS breadcrumbs), and sync infrastructure. Owns `civitas_inspection`. 14 modules. Field-heavy — inspectors work offline on mobile devices.

- **Owner / escalation:** primary: Inspection/Regulatory Domain Owner. Secondary: SRE. Page on sync infrastructure failure (inspectors can't upload completed inspections).

- **Dependencies:**
  - Own Postgres DB (`civitas_inspection`), RLS enabled, tenant-scoped.
  - Redis — read-through cache for entity universe, checklist templates, assignment queue.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for entity CRUD, inspection-type create, provision create, vocabulary upsert, risk scoring, planning, checklist, assignment, execution, findings, CAPA, enforcement, licence, survey, sync, telemetry; events mirroring all mutations.
  - Mobile sync: inspectors download their assigned checklists offline, conduct inspections without connectivity, and sync results when back online. The sync module handles conflict resolution (server wins for assignment changes, client wins for findings data).
  - Storage: evidence photos and documents stored in S3/MinIO.
  - Cross-service: workflow-service (enforcement actions may require multi-level approval), notification-service (inspection scheduling alerts), location-service (geographic assignment).

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: inspections by status (planned/assigned/in-progress/completed), coverage rate (entities inspected / total universe), findings by severity, CAPA closure rate, sync queue depth, inspector GPS telemetry.
  - Alert: sync queue depth > 100 = WARN (inspectors can't upload); CAPA overdue > 30 days = WARN; risk scoring failure = WARN.

- **Common failure modes → action:**
  - *Inspector sync failing* → sync uploads completed inspections from mobile devices. If sync is failing, check: (1) storage connectivity (photos can't upload), (2) payload size (large inspections with many photos may exceed upload limits), (3) conflict resolution (if the same inspection was modified server-side while the inspector was offline, conflict resolution kicks in — verify it's working correctly).
  - *Risk scoring not updating* → risk scores determine inspection priority. If scores are stale, verify the risk-scoring scheduled job is running. Scores are based on entity history (previous findings, compliance rate) — if the source data changed but scores didn't update, the computation consumer may be failing.
  - *Checklist assignment not reaching inspectors* → inspectors download their assignments during sync. If assignments aren't showing on mobile, verify: (1) the assignment was created server-side, (2) the inspector's device is syncing (check telemetry for recent heartbeat), (3) the sync filter correctly includes the assignment in the inspector's download set.
  - *CAPA not tracking* → Corrective and Preventive Actions are created from findings. If CAPAs aren't being created, check the findings-to-CAPA automation rules. Some findings may not meet the severity threshold for automatic CAPA creation.
  - *Evidence upload corrupted* → photos uploaded via mobile sync should be validated (MIME type check, size check). If corrupted files are appearing, the mobile app's image compression may be failing. This is a client-side issue — verify the Flutter app's image processing.
  - *Enforcement stuck in approval* → enforcement actions (penalties, licence revocation) may require multi-level approval via workflow-service. Check the approval instance.

- **Rollback:** redeploy previous image tag. Inspection records are append-only (completed inspections are immutable). Sync conflict resolution is deterministic — rollback won't change already-synced data.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) check the sync queue — inspections uploaded during the gap may need to be re-uploaded (mobile app should retry automatically); (2) verify risk scores are current; (3) evidence in S3 is not affected by DB restore.
