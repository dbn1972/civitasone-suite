# matrix — configurable cross-sell matrix

Covers RTM row **XS-001**. A matrix cell says "when a customer holds product A,
recommend product B", optionally narrowed to a segment and/or a channel, weighted, and
effective-dated. It is data-driven configuration: no product logic lives in code.

The base table and CRUD predate XS-001; this document records what XS-001 added and the
semantics that are not obvious from the column names.

## Per-cell weight — `weightBps`

Integer **basis points**, 0..10000 (= 0%..100%). A ratio, not money, so the
bigint-minor-units rule does not apply — but integer bps rather than a float because the
value is compared and ordered, and a binary float cannot represent 0.35 exactly, so two
cells authored as "35%" could sort inconsistently.

## Effective dating — `effectiveFrom` / `effectiveTo`

**Half-open** `[from, to)`. A cell whose window ends exactly at the evaluation instant
is already expired. That is what lets back-to-back windows (`to` = next `from`) tile the
timeline with neither a gap nor an overlap, so exactly one version of a cell is live at
any instant. `NULL` on either side means that side is open.

A zero-length window (`from == to`) is rejected with 422: under half-open semantics it
could never be live, so accepting it would silently store dead configuration. An
unparseable bound fails closed — a garbled date must not widen a campaign window.

PATCH validates the **merged** window, so patching only `effectiveTo` is still checked
against the stored `effectiveFrom`.

## Resolution — `POST /v1/recommendations/matrix/resolve`

Given the products a customer holds plus an optional `asOf`, segment and channel,
returns the companion products the configuration implies. It is a **read**: it resolves
configuration and records nothing as served (that stays with `POST /v1/recommendations`),
so previewing options does not pollute the served log.

Two behaviours worth knowing:

- **Duplicate companions collapse, taking the MAX priority and MAX weight — never a
  sum.** Two held products can both point at the same companion. Summing would let a
  tenant inflate a product's rank just by authoring more rows for it, which is a
  configuration accident, not a business signal.
- **Companions the customer already holds are suppressed** by default
  (`excludeHeld: false` to override). Recommending a product someone owns is the most
  visible cross-sell failure there is.

Ordering is total and therefore reproducible: priority DESC, weightBps DESC,
recommendedProductId ASC. The product id is unique per companion, so the comparator
never returns 0 for two distinct companions and the result does not depend on input
order or sort stability.

`resolveCompanions` is pure — `asOf` is a parameter, not a clock read — so a resolution
can be reproduced from its inputs months later.

## Reuse

`isEffectiveAt`, `validateEffectiveWindow`, `validateWeightBps` and `MAX_WEIGHT_BPS` are
imported by `modules/triggers` rather than duplicated, so effective dating and weighting
mean exactly one thing across the service.

## Table

`recommendation.cross_sell_matrix` — migration `0006_cross_sell_matrix_effectivity.sql`
adds the three XS-001 columns additively (nullable or defaulted, so existing rows and
existing API clients are unaffected). RLS enabled and forced.
