# push — web push subscriptions and in-app messaging (MT-006)

Owns PG schema **`push`**.

## A device token is a credential, not just an identifier

Anyone holding a device token can push to that device, so it is treated exactly like PII:

- `device_token` and `endpoint` are stored through `encryptedText()` (AES-256-GCM at rest).
- `token_hash` is a keyed HMAC blind index — irreversible plain text — which exists so the
  per-user unique constraint and de-dup work over a non-deterministic ciphertext.
- Responses return `maskDeviceToken()` output (`****` + last 4). The prefix is fixed-width
  so the token length is not leaked either.
- The token never appears in a log line, at any level.

## Push requires opt-in

Opt-out is enforced on the shared send path, not here. `sendPush()` publishes
`notification.send` with `channel: "push"`, and `modules/deliveries/channel.ts`
`resolveChannelOrder()` includes push only when `pref?.push` is true. A row with
`push=false` is an explicit refusal, and the absence of a row means the recipient has
expressed nothing — push is interruptive, so silence is not consent.

`pushAllowedByPrefs()` and `selectDeliverableSubscriptions()` in `domain.ts` state the
same rules as pure functions and are unit-tested, but **nothing in `src` calls them
today**: the shared delivery path is the single enforcement point. They are kept as the
executable specification of the rule; if push ever gains its own consumer, that consumer
should call them rather than restate the logic. Treat a divergence between them and
`deliveries/channel.ts` as a bug in whichever is wired.

Web Push endpoints must be HTTPS (`isValidWebPushEndpoint()`) — a plaintext endpoint
leaks the ability to push, on the wire. The database enforces the companion rule: a `web`
subscription without an endpoint is refused by CHECK, because it would be a silent no-op.

`selectDeliverableSubscriptions()` drops disabled rows and collapses duplicate token
hashes, preserving order so the first registration of a token wins. A device registered
twice is pushed once.

## Routes

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/v1/notification/push/subscriptions` | read | masked tokens only |
| POST | `/v1/notification/push/subscriptions` | self | 202; upsert on re-registration. 422 `INVALID_ENDPOINT` when a web subscription's endpoint is not HTTPS |
| DELETE | `/v1/notification/push/subscriptions/:id` | self | 202 — revoke, row retained for audit |
| POST | `/v1/notification/push/send` | admin | 202; 422 `NO_ACTIVE_SUBSCRIPTION` rather than a delivery that silently never arrives |
| GET | `/v1/notification/in-app/messages` | self | paginated; `meta.unread` drives the badge. Reading another user's inbox additionally requires admin |
| POST | `/v1/notification/in-app/messages` | admin | 202 |
| POST | `/v1/notification/in-app/messages/:id/read` | self | 202; 404 when not the caller's message. First read only — repeats are no-ops |

The preference check (`pushAllowedByPrefs()`) is applied by the consumer, not the route:
the route only refuses a send when there is no device to send to at all.

## Events

`notification.push.subscription.registered`, `.revoked`,
`notification.in_app.message.created`, `.read_marked` — payloads in `src/topics.ts`. The
device token is deliberately absent from every payload.

## Tables

`push.push_subscriptions`, `push.in_app_messages` — migration
`0026_deliverability_experiments_push_bounces_inbox.sql`. RLS enabled and forced,
tenant-isolation policy on `app.tenant_id`. `(tenant_id, user_id, token_hash)` is unique
and is the arbiter for `upsertSubscription()`'s `ON CONFLICT`, so re-registering a device
updates rather than accumulates.

## Dependencies

- `templates/domain.ts` — `PrefView`, so opt-out semantics mean one thing service-wide.
- `shared/pii-crypto.ts` — `encryptedText()` and the blind index. Fails closed when
  `NOTIFICATION_PII_KEY` is unset.
