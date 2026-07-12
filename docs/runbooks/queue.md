# Runbook: queue-service

> Tier 0 (bus). Follows the standard template in `docs/operations/SLO-SLI-RUNBOOKS.md` §5.
> SLO: 99.95% availability, publish < 100 ms, DLQ depth = 0, lag < 60s (see §3).

- **Purpose:** the platform's message-bus front door — exposes queue driver status/health (`/v1/queue/status`) and bridges client-facing queue operations to the underlying `@civitasone/queue` adapter (SQS in AWS, RabbitMQ on-prem via `QUEUE_DRIVER`). Every other service's command/event traffic depends transitively on this bus being healthy, even though most services talk to `@civitasone/queue` directly rather than through this service's HTTP surface.

- **Owner / escalation:** primary: Platform Architecture on-call. Secondary: SRE. Page immediately — a bus outage is a full-outage incident (Charter §38.5: "queue bus down → no writes processed" platform-wide, since all mutations are CQRS command→queue→consumer).

- **Dependencies:**
  - No own Postgres database for message data — the bus itself is the dependency surface (AWS SQS or RabbitMQ per `QUEUE_DRIVER`).
  - `@civitasone/auth` — bearer or `x-internal: 1` required on `/v1/queue/status`.
  - LocalStack (dev/test SQS emulation) or production SQS/RabbitMQ endpoint.
  - Consumed indirectly by all 33 services' workers (`<svc>-worker` processes) — none query queue-service directly for message delivery; they use the shared `@civitasone/queue` client against the same underlying driver.
  - Gateway — routes `/api/v1/queue` (upstream path `/v1/queue`).

- **Key dashboards:**
  - `/ops/*` (heartbeat, captured errors) via `registerOpsRoutes` with `checks: { queue: bus }`.
  - `/v1/queue/status` — driver identity (`sqs`/`rabbitmq`), `healthy` boolean, DLQ note (per-service DLQ lives in `MemoryQueue.dlq` in tests; SQS DLQ per AWS config in production).
  - Grafana/CloudWatch (AWS) or RabbitMQ management UI (on-prem): queue depth per topic, consumer lag, DLQ depth across all 33 services' topics.

- **Common failure modes → action:**
  - *Bus unreachable* (`healthy: false` on `/v1/queue/status`) → this is the platform's backlog-incident trigger (§38.5: "queue lag > 5 min or DLQ depth growing unbounded on any Tier-0/1 topic"); check the underlying SQS/RabbitMQ endpoint connectivity and credentials before assuming an application bug.
  - *DLQ filling across many services simultaneously* → likely a shared infra issue (bus connectivity, credential expiry) rather than per-service poison messages; escalate to Platform Architecture before redriving individual DLQs.
  - *Publish latency > 100ms target* → check bus-side throughput/throttling (SQS API rate limits, RabbitMQ broker load) before suspecting queue-service itself, since it's a thin bridge.
  - *Consumer lag climbing platform-wide* → check for a broker/queue capacity issue (RabbitMQ disk-backed alarm, SQS visibility timeout misconfiguration) rather than a single service's worker.
  - *401/403 on `/v1/queue/status`* → confirm caller supplies either a bearer token or the internal `x-internal: 1` header with correct routing.

- **Rollback:** redeploy previous image tag. Queue-service itself holds no schema/migrations to roll back; a broker-side configuration rollback (e.g. reverting a RabbitMQ policy change or SQS redrive policy) may be required — coordinate with Platform Architecture before changing broker config under load.

- **Recovery (RPO/RTO):** the bus itself is not a database with a backup/restore cycle — recovery means restoring broker connectivity/credentials and, if messages were lost during an outage window, coordinating with affected services on gap detection (each consumer's own outbox/idempotency guard prevents duplicate processing on redelivery). Treat any suspected message loss as a Tier-0 incident; target the same ≤15 min RPO / ≤4h RTO as other Tier-0 services for the surrounding infrastructure recovery.
