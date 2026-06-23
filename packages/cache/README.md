# @civitasone/cache

The single read-through cache on the hot path. Every query handler consults the
cache before Postgres; the write path primes (`put`) and invalidates entries.

Key convention (enforced by `makeKey`): `{service}:{tenant}:{resource}:{id}`.
A service may only address keys under its own `{service}` prefix.

## 04-T5 — cache-invalidation consistency

### The finding

The 31 service consumers invalidate the read cache **after** the database
transaction commits, but **outside** the transaction:

```
BEGIN; ... write ...; COMMIT;     // (1) durable in Postgres
cache.invalidate(key);            // (2) separate network call, AFTER commit
```

If the process crashes (or the Redis call fails) in the window between (1) and
(2), the read cache keeps serving the **pre-write** value. There is no second
chance to invalidate, so the stale entry would live until it expires.

### The decision: **both (a) and (b)**

The prompt allowed either invalidating via the event/relay path **(a)** or
accepting TTL staleness and documenting it **(b)**. We do the pragmatic,
low-blast-radius **both**, entirely within `packages/cache` (no consumer edits):

1. **Bounded TTL backstop (b).** Every entry now has a TTL clamped to
   `[MIN_TTL_SECONDS, MAX_TTL_SECONDS]`. A missed invalidation **self-heals**
   within at most the entry's TTL — staleness can no longer be unbounded, even
   if a caller asks to "cache forever". Combined with `getOrLoad`, which
   repopulates from the source of truth on a miss, the system converges back to
   correct data automatically.
2. **Correct-pattern helper (a).** `invalidateAfterCommit(tx, key)` expresses
   the intended "invalidate **on** commit" semantics. If the transaction object
   exposes an `onCommit` hook, the invalidation is registered to run
   transactionally on commit, which **closes the staleness window entirely**.

### Why the helper falls back to TTL today

The DB layer (`@civitasone/db`) is built on `drizzle-orm/postgres-js`. Drizzle's
`db.transaction(cb)` resolves the callback and then commits; it does **not**
expose a post-commit hook. So `invalidateAfterCommit`:

- **uses the commit hook** when a tx wrapper provides `onCommit` (future-proof),
  otherwise
- **invalidates immediately** and relies on the bounded TTL as the self-healing
  backstop — functionally equivalent to today's post-commit `invalidate(key)`,
  but documented and centralised.

When a transactional commit hook becomes available in the DB layer, consumers
can adopt `invalidateAfterCommit(tx, key)` to eliminate the window with **no
change to this package's public API**.

### TTL guarantee

| Constant             | Value      | Meaning                                            |
| -------------------- | ---------- | -------------------------------------------------- |
| `MIN_TTL_SECONDS`    | `1`        | floor; sub-minimum / zero / negative values raise to this |
| `DEFAULT_TTL_SECONDS`| `60`       | used when no TTL is configured or passed           |
| `MAX_TTL_SECONDS`    | `3600`     | hard cap; over-large / `NaN` / `Infinity` lower to this |

All write paths (`put`, `getOrLoad`, `listOrLoad`, and the constructor default)
route TTLs through `clampTtl`, so **no entry can ever live forever**.

### Accepted staleness window

> **Max staleness from a missed invalidation = the entry's TTL,**
> which is at most **`MAX_TTL_SECONDS` (3600s / 1 hour)** and **60s by default**.

In the crash window described above, a reader may observe the pre-write value
for at most the remaining TTL of that entry. After expiry, the next read misses
and `getOrLoad` repopulates from Postgres. This is the explicitly accepted
trade-off for read caches under 04-T5; tighten `defaultTtlSeconds` per service
if a smaller window is required for a specific resource.

## API (backward compatible)

```ts
const cache = new Cache({ service: "finance", defaultTtlSeconds: 60 });

const key = cache.makeKey(tenantId, "invoice", id);

// read-through (repopulates on miss)
const invoice = await cache.getOrLoad(key, () => loadInvoice(id));

// read-your-writes prime
await cache.put(key, invoice);

// write-path invalidation — prefer this over bare invalidate()
await cache.invalidateAfterCommit(tx, key);
await cache.invalidateResourceAfterCommit(tx, tenantId, "invoice");

// still available, unchanged
await cache.invalidate(key);
await cache.invalidateResource(tenantId, "invoice");
```

## Tests

`tests/ttl-invalidation.test.ts` proves:

- an entry written without an explicit TTL expires by the default TTL (time advanced via fake timers);
- `getOrLoad` repopulates from the loader on a miss;
- configured and explicit TTLs are capped at `MAX_TTL_SECONDS` (no "forever" entries);
- `invalidateAfterCommit` registers on a commit hook when present, and invalidates immediately otherwise.

```bash
pnpm --filter @civitasone/cache typecheck
pnpm --filter @civitasone/cache test
```
