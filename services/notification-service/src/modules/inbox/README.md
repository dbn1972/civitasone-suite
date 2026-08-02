# inbox — inbound conversations, keyword auto-responses, human handoff

Owns PG schema **`notification`** (shared with the core notification tables). Four
concerns live here:

| Requirement | Files |
|---|---|
| CH-07 inbound messages → leads | `inbound-routes.ts`, `consumer.ts` |
| CH-09 convert conversation to ticket | `convert-routes.ts` |
| INT-04 inbox ↔ ticket correlation | `correlation-*.ts` |
| CR-MKT-06 keyword auto-responses | `keyword-*.ts` |
| F.5 human handoff (AI pause/resume) | `handoff-*.ts` |

## CR-MKT-06 — keyword matching

Inbound SMS text is whatever the sender typed: mixed case, stray whitespace, smart
punctuation, a trailing full stop. `normalizeKeyword()` canonicalises once — trim,
lowercase, collapse whitespace runs, strip leading/trailing non-alphanumerics — so
`STOP.` and `"STOP"` both match `STOP`. Unicode letters and digits are preserved, so
Hindi keywords normalise correctly.

`prefix` matching is word-boundary aware: `stop` must not match `stopwatch reminder`.

Precedence, most significant first:

1. Channel-specific rules beat channel-agnostic (`channel = null`) ones.
2. Match type: `exact` > `prefix` > `contains`. Matching the whole message is a stronger
   signal than finding the word somewhere.
3. Explicit `priority` ascending — the operator's override.
4. Longer keyword wins: `stop all` is more specific than `stop`.
5. Rule id ascending, purely for determinism. Never a coin flip.

**There is deliberately no UNIQUE constraint on `(tenant_id, keyword, match_type, channel)`.**
SQL cannot reproduce `normalizeKeyword()`, so a unique index would enforce a *different*
rule than the matcher: rejecting rows the app considers distinct while still admitting
pairs it considers identical. `compareRules()` gives a total ordering over duplicates, so
ambiguity is impossible at match time, and a misleading constraint is worse than none.

## F.5 — handoff state machine

```
ai_handling  --pause-->        paused
ai_handling  --assign_human--> human_handling   (agentId required)
ai_handling  --close-->        closed
paused       --assign_human--> human_handling   (agentId required)
paused       --resume_ai-->    ai_handling
paused       --close-->        closed
human_handling --pause-->      paused
human_handling --resume_ai-->  ai_handling
human_handling --close-->      closed
closed       -- (nothing)
```

`isAiPaused()` is the single flag the AI agent reads to decide whether it may reply.

Deliberate omissions, so every rejection means something:

- `assign_human` from `human_handling` is **invalid**. Reassignment between humans does not
  change the AI's state, and modelling it here would make "is the AI paused?" ambiguous.
- `pause` from `paused` is **invalid** — it hides a double-submit rather than reporting it.
- `closed` accepts nothing. A closed conversation is reopened by starting a new one, which
  keeps the audit trail unambiguous.

Invalid transitions surface as **422** (`INVALID_TRANSITION` / `AGENT_REQUIRED`), not 400 —
the request was well-formed, the business rule refused it.

## Routes (new in this lane)

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/v1/notification/inbox/keyword-rules` | read | paginated `{ data, meta }` |
| POST | `/v1/notification/inbox/keyword-rules` | write | 202; 422 when neither body nor action |
| PATCH | `/v1/notification/inbox/keyword-rules/:id` | write | 202, optimistic-locked |
| POST | `/v1/notification/inbox/keyword-match` | read | dry-run the matcher, writes nothing |
| GET | `/v1/notification/inbox/:conversationId/handoff` | read | current state + allowed actions |
| POST | `/v1/notification/inbox/:conversationId/handoff` | write | 202; 422 on an invalid transition |

## Events

`notification.inbox.keyword_rule.created`, `.keyword_auto_responded`,
`.handoff.state_changed` — payloads in `src/topics.ts`. The auto-response event
deliberately omits the sender.

## PII

`inbound_auto_responses.sender` is a phone number or email address, stored through
`encryptedText()`; `sender_hash` is the keyed HMAC blind index used for per-sender history
lookups without decryption.

## Tables

`notification.keyword_rules`, `notification.inbound_auto_responses`,
`notification.conversation_handoffs`, `notification.handoff_audit` — migration
`0026_deliverability_experiments_push_bounces_inbox.sql`;
`notification.inbox_correlations` — migration `0025_inbox_correlations.sql`. All RLS
enabled and forced with a tenant-isolation policy on `app.tenant_id`.
`(tenant_id, conversation_id)` is unique on `conversation_handoffs` — one handoff row per
conversation is the whole point of the state machine, and it is the `ON CONFLICT` arbiter.
A `human_handling` row without an `assigned_agent_id` is refused by CHECK, mirroring the
state machine's `AGENT_REQUIRED`.
