# CivitasOne — Test Infrastructure

**Date:** 2026-07-27  
**Status:** Implemented  

---

## 1. Ephemeral Database Isolation (B1)

### Problem (proven this session)

Running tests >1-wide against the shared `:5435` Postgres produces false failures
from cross-suite contention. Finance/procurement passed only in isolation; 11
false failures from shared state.

### Solution

Each test lane runs against an ephemeral, per-run database:

1. **CI (GitHub Actions):** Service containers spin up a fresh Postgres per job.
   `scripts/ci/bootstrap-postgres.sh` creates per-service DBs + runs migrations.
2. **Local parallel runs:** Use `createTestDb()` helper that creates a uniquely-
   named database (`test_<service>_<pid>_<timestamp>`), runs migrations, returns
   connection, and drops on cleanup.
3. **Vitest globalSetup:** Each service's vitest config sets `DATABASE_URL` to
   point to its own isolated DB (already done via per-service vitest.config.ts).

### PostGIS requirement

The location-service requires PostGIS. CI uses `postgis/postgis:16-3.4` image.
The standard `:5435` Postgres on dev machines lacks PostGIS — this caused
migration 0011 to silently no-op. The test harness detects and skips PostGIS-
dependent tests when the extension is unavailable.

---

## 2. Determinism Rules (B2)

### Banned in tests:
- `Date.now()` without injection
- `Math.random()` without seed
- `new Date()` without explicit value

### Required:
- Inject clocks via `vi.useFakeTimers()` or explicit parameters
- Seed random via `fast-check` for property-based tests
- Tests must be order-independent (Vitest runs in random order by default)
- Quarantine flaky tests to `tests/quarantine/` — a flaky is a bug

---

## 3. Test Auth (HS256 Bypass)

All test environments use:
```typescript
JWT_ALGORITHM=HS256
JWT_SECRET=test_secret_for_civitasone_32chr
```

Token generation:
```typescript
import { signToken } from "@civitasone/auth";
const token = signToken({
  sub: userId, tid: tenantId, roles: [...], sid: "test-session"
}, SECRET);
```

---

## 4. Queue/Cache in Tests

```
QUEUE_DRIVER=memory   — in-process queue (synchronous for determinism)
CACHE_DRIVER=memory   — no Redis dependency in unit/integration tests
```

---

## 5. Evidence Emission

Every test run writes:
- JUnit XML: `evidence/<date>/<lane>-junit.xml`
- JSON summary: `evidence/<date>/<lane>-summary.json`
- Artifacts: `evidence/<date>/<lane>/` (screenshots, traces, etc.)

Vitest reporters configured via `--reporter=junit --outputFile=...`.

---

## 6. CI Concurrency

| Lane | Parallelism | Isolation |
|------|-------------|-----------|
| Per-service unit tests | Turborepo parallel | Own DB per service |
| Cross-service contracts | Sequential | Shared (read-only analysis) |
| Integration tests | Sequential | Fresh DB per run |
| E2E (Playwright) | 1 worker | Mock gateway or isolated stack |
| Load (k6) | 1 | Dedicated stack |

---

## 7. Seed/Data Management (B6)

- `scripts/demo/seed-demo.mjs` personas + PII-safe synthetic data
- Per-run reset via `TRUNCATE ... CASCADE` before each integration suite
- Large-scale generator: 100 tenants, 1M rows for scale testing
- Demo credentials: documented in TEST-STRATEGY.md
