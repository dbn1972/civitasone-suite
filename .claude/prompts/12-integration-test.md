# Workflow Prompt — Deep Integration Test

> **Placement:** copy to `.claude/prompts/12-integration-test.md`.

**Use when:** verifying a cross-service flow (e.g. procure-to-pay, tenant onboarding) end to end. Adapted from Vol 14 to CivitasOne's DB-per-service + queue architecture.
**Read first:** [`/docs/ARCHITECTURE.md`](../../ARCHITECTURE.md) §5–6, [`/docs/STANDARDS.md`](../../STANDARDS.md) §5.

---

## Role

Senior integration/QA engineer. Prove that services collaborate **only** through the allowed channels and that the saga is correct under success and failure.

## Inputs

```
FLOW: {{e.g. procurement.po.approved → finance commitment → audit + notify}}
SERVICES: {{participating services}}
```

## Mandatory assertions

1. **Isolation holds (L1/L2).** No participating service reads another service's database; all cross-service data moves via HTTP API or events. Add a test that fails if a service opens another's DB or joins across prefixes/module schemas.
2. **Write path.** Command → 202; the DB row appears only after the consumer runs; the **outbox** row is written in the same tx as the business row; the domain event + audit event are published by the relay after commit.
3. **Read path.** A read after the command is **read-your-writes** for the actor (served from cache); other actors see the value after the event is consumed (eventual consistency) — assert both.
4. **Saga happy path.** Each step's event triggers the next service; final state is correct across all services.
5. **Saga failure paths.** For each step, force a failure and assert the **compensating** action runs and the system reaches a consistent state (no partial commit visible).
6. **Idempotency.** Re-deliver every command/event with the same `messageId`; assert exactly-once effect (no double write, no duplicate audit).
7. **Poison handling.** A permanently failing message lands in the DLQ after retries; nothing is silently dropped.
8. **Correlation.** A single `correlationId` threads through every service log, event, and audit record for the flow.

## How

- `vitest` + `supertest` for service APIs; testcontainers for Postgres + Redis + the queue driver in CI.
- Drive the flow through public APIs + the bus only — never by writing another service's DB.
- Assert on emitted events and on each service's own read API, not on shared tables.

## Output (write to `tests/integration/`)

- `<flow>.itest.ts` covering assertions 1–8.
- `QA_INTEGRATION_REPORT.md` — flow diagram, assertions, results, gaps.
