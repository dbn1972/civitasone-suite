# bounces — hard/soft classification and the suppression list (INT-12)

Owns PG schema **`bounces`**.

## Classification follows the SMTP status, with two documented deviations

Base rule, per RFC 3463 enhanced status codes and RFC 5321 reply codes:

- `5.x.x` / `5xx` — permanent failure → **hard**
- `4.x.x` / `4xx` — transient failure → **soft**

Two cases where a naive first-digit read is wrong, and real ESPs classify the other way.
Getting these backwards either permanently blocks a good address or keeps hammering a
dead one:

- **`5.2.2` mailbox full** is a permanent code describing a temporary condition. Treated
  as **soft** — the mailbox can be emptied. Same for `5.3.1` and `5.3.4`.
- **`4.1.1`** is emitted by some MTAs for an unknown mailbox. Treated as **hard**.

Reason text can override the code in both directions: a `5xx` with an explicit
"mailbox full" is soft, and a `4xx` with an explicit "user unknown" is hard. Hard reason
patterns are checked before soft ones so a "mailbox unavailable" is not masked by the
generic "try again later" boilerplate some MTAs append to every DSN.

## `unknown` never suppresses

With no usable code and no matching reason keyword, classification is `unknown` and
`decideSuppression()` returns `{ suppress: false, reason: "not_a_bounce" }`. A false hard
bounce permanently blocks a legitimate recipient, so the module refuses to guess. `2.x.x`
is a success code and is likewise `unknown`, not a bounce.

The route enforces the same principle up front: a bounce with neither `smtpCode` nor
`reason` is **422 UNCLASSIFIABLE_BOUNCE** rather than a stored `unknown` row.

## Threshold resolution

`resolveSoftBounceThreshold()` — per-tenant setting, then
`NOTIFICATION_SOFT_BOUNCE_THRESHOLD`, then the documented default of 5. Never hardcoded
at a call site. `softBounceCount` includes the bounce being classified now, so a
threshold of 5 suppresses on the 5th soft bounce. The DB enforces `> 0`: a zero threshold
would suppress every recipient on their first soft bounce.

## PII

`recipient` on both `bounce_events` and `suppression_list` is an email address or phone
number, stored through `encryptedText()` (AES-256-GCM). `recipient_hash` is a keyed HMAC
blind index — irreversible — and is what suppression lookups and the per-tenant unique
constraint run against, since the ciphertext is non-deterministic. Recipient values are
accepted in request bodies and query strings but are never echoed back in a response and
never logged.

## Routes

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/v1/notification/bounces` | write | 202; 422 when unclassifiable |
| GET | `/v1/notification/suppressions` | read | paginated; `activeOnly` defaults to true |
| GET | `/v1/notification/suppressions/check` | read | `{ suppressed, entry }` |
| DELETE | `/v1/notification/suppressions/:id` | write | 202 — release |

Every write is a queued command, so no route on this module can return 404; a missing id
is resolved by the consumer (which emits nothing and logs the outcome) rather than by the
route.

## Events

`notification.bounce.recorded`, `notification.suppression.added`, `.released` — payloads
in `src/topics.ts`. Payloads carry `recipientHash`, never an address.

## Tables

`bounces.bounce_events`, `bounces.suppression_list`, `bounces.suppression_settings` —
migration `0026_deliverability_experiments_push_bounces_inbox.sql`. RLS enabled and
forced, tenant-isolation policy on `app.tenant_id`. `(tenant_id, recipient_hash)` is
unique on `suppression_list` and is the arbiter for `upsertSuppression()`'s
`ON CONFLICT`; it is deliberately a plain (non-partial) index, because a partial one
cannot serve as an upsert arbiter.
