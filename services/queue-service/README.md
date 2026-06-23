# queue-service — message bus & delivery contract

The canonical CivitasOne message bus. Domain services publish/subscribe via
`@civitasone/queue` (facade) or `@civitasone/queue-service` directly. Two drivers:

| `QUEUE_DRIVER` | Use                          | Semantics |
| -------------- | ---------------------------- | --------- |
| `memory`       | tests / explicit local dev   | in-process, push-based |
| `sqs`          | production / LocalStack      | AWS SQS, poll-based |

The driver **fails closed**: outside tests an unset/unknown `QUEUE_DRIVER` is a
hard error, and `memory` is forbidden in production (see `resolveQueueDriver`).

## Delivery contract

### Standard topics — at-least-once + unordered

A standard SQS queue is **at-least-once** and **unordered**:

- A message may be delivered **more than once** (redelivery after a visibility
  timeout, at-least-once relay from the transactional outbox).
- Messages may arrive **out of order** relative to publish order.

Because delivery is at-least-once, **handlers must be idempotent**. Idempotency
is the consumer's responsibility, enforced via the `_inbox.processed` table:

```ts
queue.subscribe<CreateThing>(COMMANDS.createThing, async (msg) => {
  await db.transaction(async (tx) => {
    // markProcessed inserts msg.messageId into _inbox.processed; returns false
    // if it was already processed → a duplicate delivery is a no-op.
    if (!(await markProcessed(tx, msg.messageId))) return;
    // ... apply the write + enqueue outbox events ...
  });
});
```

`markProcessed` (in `@civitasone/outbox`) keys on `messageId`, which is stable
across redeliveries of the same message. This collapses duplicate deliveries to
a single apply. The bus also de-dupes structurally invalid envelopes straight to
the DLQ (see `parseEnvelope`) and dead-letters poison messages after
`SQS_MAX_RECEIVE_COUNT` receives.

### Order-sensitive topics — FIFO + MessageGroupId

Some flows are **order-sensitive**: the order of application changes the result.
The clearest example is **ledger / journal postings**, where postings must apply
in the order they were issued to keep running balances correct. For these, a
standard unordered queue is not enough.

Use a **FIFO topic** by giving the topic name a `.fifo` suffix. FIFO queues add
**strict ordering within a message group** and **broker-side exactly-once within
a 5-minute dedup window**.

#### How FIFO is wired (05-T4)

The bus enables FIFO purely from the topic-name convention — no API change is
required at the call site, and default behaviour for non-`.fifo` topics is
unchanged:

- `isFifoTopic(topic)` → true when the topic ends with `.fifo`.
- On publish to a `.fifo` topic, `SqsQueue` sets:
  - `MessageGroupId` = **`tenantId`** (ordering is scoped per tenant, so one
    tenant's postings are strictly ordered without serialising across tenants).
  - `MessageDeduplicationId` = **`messageId`** (exactly-once within the dedup
    window; the `messageId` is stable across outbox relays).
- The FIFO queue (and its DLQ) is created with `FifoQueue=true` and
  `ContentBasedDeduplication=false` (we always supply an explicit dedup id), and
  the queue name keeps its `.fifo` suffix as AWS requires.

Override the defaults per-publish when a finer ordering scope is needed (e.g.
order per ledger account rather than per tenant):

```ts
await queue.publish("finance.gl.post.fifo", input, {
  messageGroupId: `${input.tenantId}:${accountId}`,
  messageDeduplicationId: input.messageId,
});
```

Idempotency via `_inbox.processed` still applies on FIFO topics — FIFO dedup is
a 5-minute broker-side window; `_inbox.processed` is the durable backstop.

#### Topics that SHOULD be FIFO

| Topic                       | Why |
| --------------------------- | --- |
| `finance.gl.post`           | journal/ledger postings — running balances depend on apply order |
| `finance.gl.posted`         | downstream ledger projections must observe postings in order |
| any treasury/ledger posting | double-entry balances are order-sensitive |

To make them FIFO, publish to the `.fifo` variant (e.g. `finance.gl.post.fifo`)
and subscribe the worker to the same `.fifo` topic. Non-order-sensitive commands
(notifications, cache refreshes, search indexing, most CRUD create/update) should
stay on standard topics — FIFO throughput is lower and unnecessary there.

## Consumer liveness / readiness (09-T4)

`SqsQueue.pollTopic` calls `recordConsumerHeartbeat(service)` on every successful
receive iteration. A `*-worker` process should wire a heartbeat-backed readiness
check so that a hung or killed poll loop flips `/ready` to `503`:

```ts
import { registerOpsRoutes, consumerHeartbeatCheck } from "@civitasone/observability";

registerOpsRoutes(app, {
  service: "finance-worker",
  checks: {
    custom: [
      {
        name: "consumer",
        ping: consumerHeartbeatCheck({ maxStalenessMs: 90_000, service: "finance-worker" }),
      },
    ],
  },
});
```

If the poll loop stops recording heartbeats for longer than `maxStalenessMs`,
`ping()` returns false and `/ready` responds `503`. The last poll time is also
exposed as the `consumer_last_poll_timestamp{service}` gauge on `/metrics`.

## Testing

- `tests/*.test.ts` use `MemoryQueue` and run in CI with no external broker.
- `tests/sqs.localstack.test.ts` exercises the real `SqsQueue` and is **gated on
  `AWS_ENDPOINT_URL`** (`describe.skipIf(!process.env.AWS_ENDPOINT_URL)`), so it
  skips cleanly in CI and runs against LocalStack when the endpoint is set:

  ```sh
  AWS_ENDPOINT_URL=http://localhost:4566 pnpm --filter @civitasone/queue-service test
  ```
