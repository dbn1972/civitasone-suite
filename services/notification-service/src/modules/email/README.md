# email — sending-domain registration and DKIM/SPF/DMARC health (CR-MKT-04)

Owns PG schema **`email`**. Answers one operational question: is mail leaving this
tenant's domain actually going to be accepted?

## Why the evaluation is pure

`domain.ts` never touches the network. `dns.ts` resolves the TXT records and hands the
observed strings to the evaluator, which decides pass/fail per mechanism. That split is
what makes the whole feature testable without a resolver, and it is why the sweeper can
be exercised with an injected `resolveTxt`.

## Health roll-up

| DKIM | SPF | DMARC | Health | Meaning |
|---|---|---|---|---|
| pass | pass | pass | `healthy` | authorised and protected |
| pass | pass | not pass | `degraded` | mail delivers, domain is spoofable |
| not pass | — | — | `failing` | receivers may reject outright |
| — | not pass | — | `failing` | as above |
| missing | missing | missing | `unknown` | no signal — deliberately not a verdict |

DKIM and SPF are what receivers use to decide whether mail is authorised, so a problem
with either is `failing`. DMARC only tells receivers what to do when those two fail, so a
DMARC-only problem is `degraded`, not `failing`. All three absent reports `unknown`
rather than implying a verdict — `isSendingAllowed()` admits `healthy` and `degraded`
only, so `unknown` does not silently authorise sending.

TXT comparison normalises for the things DNS providers vary on: chunked records are
concatenated, whitespace is collapsed, and the DKIM `p=` value is compared with all
whitespace removed because providers wrap long keys differently.

## Routes

| Method | Path | Roles | Notes |
|---|---|---|---|
| GET | `/v1/notification/email/sending-domains` | read | paginated `{ data, meta }` |
| POST | `/v1/notification/email/sending-domains` | write | 202 — queued command |
| GET | `/v1/notification/email/sending-domains/:id/health` | read | latest roll-up; 404 when unknown to the tenant |
| GET | `/v1/notification/email/sending-domains/:id/auth-checks` | read | check history, newest first |
| POST | `/v1/notification/email/sending-domains/:id/auth-checks` | write | 202 — record an operator-run check |
| GET | `/v1/notification/email/dmarc-policies` | read | the admissible policy set |

## Events

`notification.email.sending_domain.registered`, `.domain_auth_check.recorded`,
`.domain_auth.failing` — payload shapes documented in `src/topics.ts`. The `failing`
event fires only on a roll-up of `failing`, and exists for alerting.

## Sweeper

`sweeper.ts` re-checks enabled domains across tenants. It reads through the
**`notification_scanner`** BYPASSRLS role (migration 0024) because it is legitimately
cross-tenant; every write still goes through `notification_svc` under RLS. A probe
failure is logged at WARN and retried next sweep — it never fails the cycle.

## Tables

`email.sending_domains`, `email.domain_auth_checks` — migration
`0026_deliverability_experiments_push_bounces_inbox.sql`. RLS enabled **and** forced,
tenant-isolation policy on `app.tenant_id`. `sending_domains.domain` is unique per
tenant and CHECK-constrained to lowercase so a mixed-case duplicate cannot slip past
the unique index.

## No PII

A sending domain is an organisational identifier, not a personal one, and check results
hold only DNS record fragments. Nothing here is encrypted because nothing here is PII.
