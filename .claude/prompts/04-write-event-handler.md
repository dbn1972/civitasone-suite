# Workflow Prompt — Write Event Handler

**Use when:** Adding a queue consumer to a service.

---

## Fill these placeholders

```
SERVICE: {{service-name}} (the CONSUMING service)
EVENT TYPE: {{e.g. finance.gl_entry.posted}}  (from @civitasone/events)
PUBLISHER SERVICE: {{which service emits this event}}
ISSUE: {{GitHub issue link}}

PURPOSE (one sentence): {{what this service does when the event arrives}}

PAYLOAD SCHEMA (must match @civitasone/events):
- {{field}}: {{type}}
- {{field}}: {{type}}

ACTION ON RECEIVE:
1. {{step 1}}
2. {{step 2}}
3. {{step 3}}

IDEMPOTENCY:
- Dedupe key: {{tenantId + eventId | tenantId + payload.someId}}
- Store in: {{service_prefix}}_processed_events (must exist — table tracking processed event IDs)
- If duplicate: log + ack + skip

RETRY POLICY:
- Max attempts: {{5 default}}
- Backoff: exponential, base 1s, max 60s
- On final failure: send to DLQ topic {{env}}.{{service}}.dlq

SIDE EFFECTS:
- DB writes: {{list tables, must be in this service's prefix only}}
- Emits its own events: {{list — chain reactions documented}}
- Calls other services: {{list HTTP calls — never DB}}
- Sends notifications: {{list — must go through notification-service via queue}}

ORDERING:
- Required? {{yes/no}}
- If yes: partition key for ordered delivery (Kafka) / FIFO group (SQS) = {{tenantId | tenantId+entityId}}

TESTS (vitest):
- Happy path: receive valid event → expected side effects observed
- Duplicate event: second receive is a no-op (dedup proven)
- Invalid payload: rejected with metric increment, sent to DLQ
- Downstream API failure: retry once, succeed
- Downstream API persistent failure: exhaust retries, land in DLQ
- Concurrent processing: two messages with same dedup key processed once total
```

---

## Output instructions for Claude

Produce these files:

1. `services/{{service}}/src/handlers/{{event-name}}.handler.ts` — handler function
2. `services/{{service}}/src/handlers/{{event-name}}.handler.test.ts` — vitest tests
3. Update `services/{{service}}/src/index.ts` to register the consumer at startup via `@civitasone/queue`
4. If new dedup table needed: run write-migration prompt for `{{service_prefix}}_processed_events`

After writing files, run:
```
pnpm --filter @civitasone/{{service}} typecheck
pnpm --filter @civitasone/{{service}} test handlers
```

---

## Anti-patterns

- Calling another service inside a DB transaction → deadlock
- Forgetting idempotency → duplicate side effects
- Calling the database of another service → forbidden
- Catching errors and ack-ing without action → silent data loss
- No DLQ wired → poison messages will block the queue forever
- Long-running handler (> 30s) → break into smaller events or schedule jobs
