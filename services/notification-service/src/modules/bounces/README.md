# bounces — hard/soft classification, complaints and the suppression list (INT-12, P1-3)

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

## A complaint is not a bounce (P1-3)

`chk_suppression_list_reason` has permitted `reason = 'complaint'` since migration 0026,
but until P1-3 nothing could produce one: there was no route, no command, no consumer and
no table. A recipient who pressed "report spam" was never suppressed and kept receiving
mail — which is how a sending domain gets blocklisted (SES suspends a sender above a 0.1%
complaint rate) and, under DPDP, how a withdrawal of consent gets ignored.

Complaints live in their own table and share none of the classification machinery above,
because the two signals are different in kind:

|  | bounce | complaint |
|---|---|---|
| whose opinion | the receiving MTA, about an address | the recipient, about our mail |
| can be ambiguous | yes — hence hard/soft/`unknown` | no |
| threshold | soft bounces accumulate to one | none — the first one is terminal |
| stored on | `bounce_events.classification` | `complaint_events.feedback_type` |

`feedback_type` is the RFC 5965 §7.3 ARF type (`abuse`, `fraud`, `virus`, `other`) and is
**diagnostic only** — all four mean "do not mail this recipient", so it never changes the
decision. `normalizeFeedbackType()` canonicalises case and separators and degrades an
unrecognised label to `other` instead of rejecting it: dropping a real complaint because
its spelling was unfamiliar would leave the recipient receiving mail. `not-spam` and
`opt-out` are deliberately not accepted values — the first is an un-suppression (that is
the release endpoint's job) and the second is already covered by `reason = 'unsubscribe'`
on the inbound opt-out path.

The suppression is written in the **same transaction** as the complaint row, for the
reason the inbound opt-out path documents: a consent withdrawal that is only eventually
applied is one a campaign fan-out can miss. No change to the R1 consent gate was needed —
it already refuses every send to an un-released `suppression_list` entry, so writing the
row *is* the fix.

## PII

`recipient` on `bounce_events`, `complaint_events` and `suppression_list` is an email address or phone
number, stored through `encryptedText()` (AES-256-GCM). `recipient_hash` is a keyed HMAC
blind index — irreversible — and is what suppression lookups and the per-tenant unique
constraint run against, since the ciphertext is non-deterministic. Recipient values are
accepted in request bodies and query strings but are never echoed back in a response and
never logged.

## Routes

| Method | Path | Roles | Notes |
|---|---|---|---|
| POST | `/v1/notification/bounces` | write | 202; 422 when unclassifiable |
| POST | `/v1/notification/complaints` | write | 202; no 422 counterpart — a complaint is never unclassifiable |
| GET | `/v1/notification/suppressions` | read | paginated; `activeOnly` defaults to true |
| GET | `/v1/notification/suppressions/check` | read | `{ suppressed, entry }` |
| DELETE | `/v1/notification/suppressions/:id` | write | 202 — release |

Every write is a queued command, so no route on this module can return 404; a missing id
is resolved by the consumer (which emits nothing and logs the outcome) rather than by the
route.

## Events

`notification.bounce.recorded`, `notification.complaint.recorded`,
`notification.suppression.added`, `.released` — payloads in `src/topics.ts`. Payloads carry
`recipientHash`, never an address. On `suppression.added`, exactly one of `bounceEventId` /
`complaintEventId` is non-null, identifying which feedback caused the suppression.

## Tables

`bounces.bounce_events`, `bounces.suppression_list`, `bounces.suppression_settings` —
migration `0026_deliverability_experiments_push_bounces_inbox.sql`;
`bounces.complaint_events` — migration `0033_complaint_events.sql`. RLS enabled and
forced, tenant-isolation policy on `app.tenant_id`. `(tenant_id, recipient_hash)` is
unique on `suppression_list` and is the arbiter for `upsertSuppression()`'s
`ON CONFLICT`; it is deliberately a plain (non-partial) index, because a partial one
cannot serve as an upsert arbiter.
