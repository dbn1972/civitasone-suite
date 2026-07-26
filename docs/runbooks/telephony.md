# Runbook: telephony-service

> Tier 3. Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.5% availability, call-event ingestion p95 < 1s (real-time call tracking).

- **Purpose:** call center / telephony management — call lifecycle (create/ring/answer/complete/miss/abandon), call routing/assignment, IVR interaction recording, call linking (to cases/tickets/contacts), call recording attachment, transcription (speech-to-text), queue management, agent management (status: available/busy/offline), DID (Direct Inward Dialing) management, and webhook integration for PBX/cloud-telephony providers. Owns `civitas_telephony`. PII-encrypted (caller numbers, recordings). Real-time event-driven (call events arrive as they happen).

- **Owner / escalation:** primary: Telephony/Contact-Center Domain Owner. Secondary: SRE. Page on call-event processing lag > 30s (agents won't see live call status).

- **Dependencies:**
  - Own Postgres DB (`civitas_telephony`), RLS enabled, tenant-scoped. PII encrypted (caller phone numbers).
  - Redis — real-time agent status (must be < 50ms for routing decisions), call state cache, queue metrics.
  - SQS/RabbitMQ topics (`src/topics.ts`): commands for call lifecycle (create/ring/answer/complete/miss/abandon), assignment, IVR hit, linking, recording, queue create, agent upsert/status; events mirroring all call transitions + transcription completed.
  - Cross-service produces: `telephony.call.missed` (consumed by helpdesk-service to auto-create callback tickets), `telephony.call.completed` (consumed by analytics for call volume dashboards).
  - External: PBX/cloud-telephony provider (via webhook — provider pushes call events to telephony-service webhook endpoint), transcription service (speech-to-text, env-gated via `TRANSCRIPTION_ENABLED`).
  - Storage: call recordings stored in S3/MinIO via `@civitasone/storage`.
  - Real-time requirements: call events must be processed within seconds to maintain accurate agent-status and queue-depth views. Any lag means agents see stale data.

- **Key dashboards:**
  - `/ops/*` (heartbeat, DLQ, consumer error rate, outbox relay).
  - Grafana: active calls, calls in queue, agent utilization (available/busy/offline), call abandonment rate, average handle time, transcription success rate, missed-call → ticket conversion rate.
  - Alert: call-event processing lag > 30s = CRITICAL (agents blind); agent-status Redis failure = CRITICAL (routing broken); call abandonment rate > 30% = WARN.

- **Common failure modes → action:**
  - *Call events not arriving (webhook)* → the PBX/cloud provider pushes events via webhook. If events stop, verify: (1) the webhook URL is reachable from the provider's network, (2) the gateway is forwarding to telephony-service correctly, (3) the provider hasn't disabled the webhook due to too many failures. Check provider dashboard.
  - *Agent status stale in Redis* → agent availability is the basis for call routing. If Redis shows an agent as "available" but they're on a call, the `telephony.call.answer` event wasn't processed. Check the consumer. If Redis is down, agent routing breaks entirely — fall back to round-robin until Redis recovers.
  - *Missed-call ticket not creating in helpdesk* → verify the `telephony.call.missed` event was published. The helpdesk-service consumer creates a callback ticket from this event. If the event was published but helpdesk isn't processing, the issue is in helpdesk-service.
  - *Transcription failing* → transcription is non-blocking (async). If the external transcription service is down, recordings are stored but not transcribed. They can be transcribed later when the service recovers. No operational impact.
  - *Call recording upload failing* → recordings go to S3/MinIO. If storage is unreachable, the recording attachment fails. The call lifecycle itself is unaffected (recording is a post-call enrichment). Retry the upload when storage recovers.
  - *Queue depth growing (calls waiting)* → this is a staffing issue (not enough available agents). The system correctly reports the queue depth. Automatic overflow to voicemail or callback can be configured per queue.

- **Rollback:** redeploy previous image tag. Call records are append-only (CDR-style). Agent status is ephemeral (Redis) and rebuilds from current state.

- **Recovery (RPO/RTO):** restore DB from ≤15-min backup; replay outbox. After restore: (1) rebuild agent-status Redis from current DB state (agents default to "offline" until they explicitly set available); (2) any calls that occurred during the gap have CDRs on the PBX/provider side — reconcile if needed; (3) recordings stored in S3 are not affected by DB restore.
