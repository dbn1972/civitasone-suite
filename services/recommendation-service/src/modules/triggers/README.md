# triggers — generic, tenant-configurable cross-sell trigger rules

Covers RTM rows **IN-007**, **FS-006** and **MP-011** with one piece of configurable
machinery rather than three code paths.

## Why it is generic

The platform must not know what any one deployment sells. `sourceCategory`,
`targetCategory` and `eventCode` are therefore opaque tenant-defined strings, not
enums, and nothing in this module names a product, a scheme or an operator. The
mapping from a real product catalogue onto these categories belongs in that
deployment's adapter (`services/adapters/*`), not here.

The three rule types are capability shapes:

| Rule type | Fires when | RTM row it satisfies |
|---|---|---|
| `holding_based` | the subject already holds enough of `sourceCategory` | IN-007 — offer a protection/insurance category off a savings-type holding base |
| `life_event` | an event of `eventCode` happened, or is scheduled to, near the evaluation instant | FS-006 — maturity approaching, address change, age threshold |
| `volume_pattern` | aggregate lane/consignment behaviour crossed the thresholds | MP-011 — premium-product leads from lane patterns |

Adding a fourth requirement of the same shape is a row in `trigger_rules`, not a
deployment.

## Condition grammar

`conditions` is a jsonb threshold bag; the full list is on `TriggerConditions` in
`schema.ts`. Every key is optional; a rule fires when the observation satisfies **all**
the thresholds it declares. A rule declaring none fires on any matching observation of
its type.

Monetary thresholds (`minHoldingValueMinor`, `minValueMinor`) are integer minor-unit
**strings**, so a threshold above 2^53 keeps its precision through JSON. `weightBps` is
integer basis points (10000 = 100%) — a ratio, so not money and not a float.

## Semantics worth knowing

- **Effective dating is half-open** `[effectiveFrom, effectiveTo)`, imported from
  `matrix/domain.ts` rather than restated, so consecutive windows tile the timeline
  with neither a gap nor an overlap.
- **`withinDays` is an absolute distance**, which is what lets one rule type express
  both a future event (maturity approaching) and a past one (address changed).
- **Gates fail closed.** An age gate with an unknown age does not fire; a malformed
  money threshold does not fire. A configuration typo must not widen a rule.
- **A target category the subject already holds is suppressed** by default.
- **Ordering is total** — priority DESC, weightBps DESC, ruleId ASC — so an evaluation
  is reproducible from its inputs.
- **`DELETE` deactivates**, it does not remove the row: attribution records naming a
  rule must keep their meaning.

## Routes

| Method | Path | Role | Notes |
|---|---|---|---|
| GET | `/v1/recommendations/trigger-rules` | reader | paginated, filterable by type/target/active |
| GET | `/v1/recommendations/trigger-rules/:id` | reader | cached read |
| POST | `/v1/recommendations/trigger-rules` | admin | 201, writes inline + outbox event |
| PATCH | `/v1/recommendations/trigger-rules/:id` | admin | optimistic-locked on `version` |
| DELETE | `/v1/recommendations/trigger-rules/:id` | admin | soft — sets `active = false` |
| POST | `/v1/recommendations/trigger-rules/evaluate` | reader | pure read; raises and ranks candidates, records nothing |

## Events

`recommendation.trigger-rule.created`, `.updated`, `.deactivated` — documented with
payload shapes in `src/topics.ts`. No commands: configuration writes are single-row and
must be readable immediately by the operator who made them, so there is no command hop.

## Dependencies

- `matrix/domain.ts` — `isEffectiveAt`, `validateEffectiveWindow`, `validateWeightBps`,
  `MAX_WEIGHT_BPS`. Reused so effective dating and weighting mean one thing service-wide.
- `nba/ranking-domain.ts` — `rankActions`. Raised triggers are scored through the
  existing ranking engine so a trigger-raised action and a matrix-raised one are
  comparable on the same 0..1 scale.

## Table

`recommendation.trigger_rules` — migration `0007_trigger_rules.sql`. RLS enabled and
forced; tenant-isolation policy on `app.tenant_id`.
