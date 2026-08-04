# @civitasone/cache — changelog

The repo's dependency rules require a changelog entry and a version bump for any change
to a `@civitasone/*` package. This file did not exist before 0.2.0, so it starts there.

## 0.2.0

### Added

- `Cache.incr(key, ttlSeconds)` and `CacheStore.incr` — **atomic** increment-and-return,
  for counters that must stay correct under concurrency (rate limiters, quotas). Returns
  the value *after* the increment, so a caller compares the return value to its budget and
  never reads-decides-writes.

  `RedisCache` uses Redis `INCR` (atomic server-side) followed by `EXPIRE`, and applies the
  TTL **only when the counter was created** (return value `1`). Re-applying it on every hit
  would slide a fixed window forward under sustained traffic, so a counter could never
  expire and a caller could be locked out permanently. `MemoryCache` implements the same
  semantics over a counter map so tests and no-Redis development behave identically.

  Motivation: `getOrLoad` → compare → `put(used + 1)` cannot be used to count. It is a
  read-modify-write, *and* `getOrLoad` deliberately coalesces concurrent cold-key callers
  onto one shared promise (stampede protection), so N parallel callers all observe the same
  pre-increment value and all pass a threshold check. crm-service's public lead-capture
  limiter was built that way and was bypassable by exactly the concurrent traffic it
  existed to stop.

### Breaking

- `CacheStore` gains a required `incr` method. Both bundled implementations
  (`RedisCache`, `MemoryCache`) provide it; only a caller supplying its own custom
  `store` needs to add one. No call sites in this repo do.
