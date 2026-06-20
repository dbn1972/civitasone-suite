# Skill — Queue Message Design

**When to load:** Building any event producer or consumer. Touching `@civitasone/queue` or `@civitasone/events`.

---

## Naming convention

Topic / queue name format:

```
{env}.{service}.{entity}.{action}
```

Examples:
- `prod.finance.gl_entry.posted`
- `prod.procurement.po.approved`
- `staging.hrms.leave.approved`
- `dev.helpdesk.ticket.sla_breached`

DLQ for any topic:
```
{env}.{service}.{entity}.{action}.dlq
```

## Message envelope (always)

```typescript
{
  messageId: string;          // UUID v7 — globally unique
  eventType: string;          // matches topic minus env, e.g. "finance.gl_entry.posted"
  schemaVersion: string;      // semver, e.g. "1.0", "1.1"
  tenantId: string;
  correlationId: string;
  actorId: string;
  timestamp: string;          // UTC ISO 8601
  retryCount: number;         // incremented by adapter
  payload: T;                 // the typed payload from @civitasone/events
}
```

## Producer rules

- **Use `@civitasone/queue` only.** Never import provider SDKs directly.
- **Publish only after DB commit.** Use outbox pattern if at-least-once delivery is needed across DB and queue.
- **Set `correlationId`** from the incoming request so consumer logs can correlate.
- **Bump `schemaVersion` on breaking changes.** Add a new event type when shape changes incompatibly.
- **Keep payload small.** Reference large blobs by URL (S3/MinIO); don't ship bytes in payload.
- **Idempotency by `messageId`.** Producer must not retry with a new id on transient publish failures — store messageId and re-publish.

## Outbox pattern (when at-least-once across DB + queue matters)

```
BEGIN TX
  INSERT into business_table (...)
  INSERT into outbox (id, eventType, payload, status='pending')
COMMIT
-- Separate worker reads outbox, publishes to queue, marks status='published'
```

This guarantees the event publishes if and only if the DB write committed.

## Consumer rules

- **Idempotency table per service:** `{service}_processed_events(message_id, processed_at)`. On receive: check table; if exists, log + ack + skip.
- **Acknowledge ONLY after side effects committed.** If side effect is a DB write, commit DB tx before ack.
- **Retry with backoff:** exponential, base 1s, factor 2, max 60s, max attempts 5 (configurable per consumer).
- **DLQ on exhaustion.** Never lose a message — DLQ + alert.
- **No long-running handlers.** > 30s: break the work into a follow-up event.
- **No DB transaction containing an outbound HTTP call.** Deadlock risk.

## Ordering

Default: no ordering guarantee. If ordering required (e.g. all events for one entity must be processed in order):

- Kafka: use `tenantId + entityId` as partition key
- SQS: use FIFO queue with `tenantId + entityId` as message group id
- RabbitMQ: use consistent-hash exchange with same key

Ordering reduces parallelism. Use only when truly needed.

## Schema evolution

- **Add a field:** non-breaking — fine
- **Make a field optional → required:** breaking — bump major schemaVersion, add new event type, deprecate old
- **Rename a field:** breaking — same as above
- **Remove a field:** breaking — same as above
- **Change a field type:** breaking — same as above

Producers must publish only the latest version. Consumers should accept versions for which they have a handler; reject (DLQ) unknown versions with a clear log line.

## Poison messages

A message that always throws on processing. Detected by: same `messageId` failing N times. Action: DLQ, page on-call, do not retry endlessly.

## Tracing

- Every publish includes W3C trace context (`traceparent`, `tracestate`) in message headers
- Consumer extracts trace context and continues the span
- Trace shows: producer span → queue dwell time → consumer span

## Metrics

Per consumer:
- `consumed_total{eventType, outcome}` — counter
- `consume_duration_seconds{eventType}` — histogram
- `dlq_total{eventType, reason}` — counter
- `lag_seconds{topic}` — gauge (consumer lag)

## Forbidden patterns

- Publishing before DB commit (creates ghost events)
- Acknowledging before side effects commit (silent data loss)
- Importing AWS SDK / kafkajs / amqplib directly outside `@civitasone/queue`
- Long-running handler that holds connections
- Skipping idempotency table — duplicates always happen at scale
- DLQ without alert (poison messages pile up invisibly)
- Including large blobs in payload (use object store + reference)
