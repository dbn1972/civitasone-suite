# ADR-0019: Event-contract policy — `defineContract` enforce, ≤45-char topics

- **Status:** Accepted
- **Decision id:** D-ST-19 (APPROVED, approval log 2026-10-09)
- **Date:** 2026-10-09
- **Deciders:** Chief Architect; programme owner dbn1972 (approved)
- **Spec:** §4; §11 (module integration); §16 (API & contract tests); §18 M01
- **Related:** platform decision **D-18** (WAVE0-DECISIONS.md §1, in-house zod walker); house rule 8;
  [event-list](../event-list.md); delivered by **ST-M01-06**

## Context

There are **zero production event contracts** today: `defineContract` (`packages/events/src/contracts/define.ts`) has no
production caller and per-topic schema versions are empty (M00 §1.11, verified on `origin/main` `9d4fa95e5`). The
transport exists (queue facade over `services/queue-service/src/bus.ts`, outbox/inbox in `packages/outbox`), and the
`defineContract` DSL exists (built under FF-02 / D-18) but defaults each new contract's mode to `"off"`
(`define.ts` `defineContract`: `const mode = input.mode ?? "off"`).

The queue derives a per-service queue name by replacing dots with dashes and truncating to **`TOPIC_BASE_MAX = 45`**
(`bus.ts:475-478`; `topicBaseName`/`perServiceQueueName` at `:476-495`). A topic whose dash form exceeds 45 characters
would be truncated and could collide with another topic's queue.

SmartTransfer ships the first real contracts for the platform, so it sets the policy.

## Decision

Every `smarttransfer.*` and `hrms.posting.*` topic ships a **`defineContract` in mode `enforce`**, and every topic name
is **≤ 45 characters after dot-to-dash**.

- `mode: "enforce"` is set explicitly on each contract (the DSL default of `"off"` is **not** acceptable for these
  topics); a payload that violates the schema throws `ContractViolationError` at the consumer gate (`define.ts`
  `assert`).
- Topic names follow `{service}.{aggregate}.{action|pastTense}` (docs/ARCHITECTURE.md §4) and the frozen set in
  [event-list](../event-list.md), each verified ≤45 after dot-to-dash (max observed 34).
- Money on the wire is a **string** field ending in `Minor` with a required `currency` from schema v2 (D-18; `define.ts`
  money rule). No C0 topic carries money.
- Every contract declares its `pii: []` list explicitly (DPDP erasure feeds off it); sensitive attributes (category,
  disability, medical, spouse) are kept out of event payloads and stay in the snapshot (M00 §8.2).
- Each topic has exactly one owner and one kind (command or event), enforced by the DSL (`define.ts` rule 1/2).
- Contract tests run under `pnpm test:contract` / `tests/contract`, consistent with the existing
  `cross-service-events.contract.test.ts` gate (M00 §1.11).

## Consequences

- A consumer that reads a field the contract does not have fails to compile (structural safety; `define.ts` header).
- Topic-name length is a hard design constraint for every future SmartTransfer topic; it is documented in
  [event-list](../event-list.md) with a measured length column.
- ST-M01-06 must add a topic-name length check and the contract tests; this ADR is the authority it cites.

## Alternatives considered

- **(b) Follow the existing untyped convention** — rejected: 0 contracts today caused the integration breaks the
  platform is fixing (M00 §1.11); SmartTransfer is greenfield and must not inherit that.
