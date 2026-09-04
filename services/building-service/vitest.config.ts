import { defineConfig } from "vitest/config";

// building-service had no local vitest config, so it silently inherited the
// repo root's `include: ["tests/**/*.test.ts"]` fallback (vitest.config.mjs)
// — which doesn't match this service's tests, co-located under src/modules/**
// the same way every other properly-configured service in this monorepo does
// (see e.g. services/hrms-service/vitest.config.ts). That's very likely *why*
// this service had zero test coverage: any test file placed the normal way
// would have been silently skipped ("No test files found") rather than run.
// This file intentionally omits `include` so vitest falls back to its own
// built-in default (`**/*.{test,spec}.ts`), which does pick up co-located
// tests, and mirrors the root config's memory-driver env so consumer tests
// don't need a real Redis/Postgres connection.
export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      // Required by notification-service's real deliveries consumer
      // (at-rest PII encryption) — only exercised by this service's own
      // tests/municipal-status-notification-integration.test.ts, which
      // dynamically imports notification-service's real modules for a
      // genuine cross-service, real-DB proof. Test-only value; production
      // injects the real key from the secret manager.
      NOTIFICATION_PII_KEY: "test_notification_pii_key_32chars",
    },
    // The default `threads` pool runs test files sequentially/concurrently
    // inside a small set of REUSED worker threads, so Node module state
    // (e.g. @civitasone/db's internal client caches) can leak across files
    // that ran in the same worker. Confirmed against a real Postgres
    // container: tests/municipal-status-notification-integration.test.ts
    // (which flips process.env.DATABASE_URL between two real cross-service
    // DB connections inside one file — see that file's header) passes
    // reliably alone or with --pool=forks, but hangs in its own beforeAll
    // ("Hook timed out") when threads reuses a worker that already ran an
    // earlier real-DB test file. `forks` gives every test file its own OS
    // process — the same isolation CI's real-DB suites need anyway — which
    // removes the leak entirely (verified: 29/30 tests green, the one
    // remaining failure is tests/rls-isolation.test.ts's pre-existing
    // sabotage-check flake, reproducible standalone and unrelated to this).
    pool: "forks",
    poolOptions: {
      forks: {
        // Explicit: vitest's own forks-pool default can still coalesce
        // fast-exiting test files onto a single fork under some configs,
        // which reintroduces the same cross-file leak this pool switch is
        // meant to remove (see the comment above). Force one OS process per
        // test file, matching the isolation verified against a real
        // Postgres container.
        singleFork: false,
      },
    },
    // `pool: "forks"` with `singleFork: false` gives every test file its own
    // OS process, but those processes still run CONCURRENTLY by default —
    // `pool` only decides the isolation mechanism, not the schedule.
    // tests/rls-isolation.test.ts's sabotage check runs a raw
    // `ALTER TABLE building.building_applications DISABLE/ENABLE ROW LEVEL
    // SECURITY` against the live civitas_building database (needs an
    // ACCESS EXCLUSIVE lock), and this service now has three real-DB
    // integration files (tests/rls-isolation.test.ts,
    // tests/municipal-fee-challan-integration.test.ts,
    // tests/municipal-status-notification-integration.test.ts) that can all
    // have open transactions against building.* tables at once. Postgres's
    // lock queue is FIFO, so once the ALTER TABLE queues behind any of
    // those, every subsequent query from every other forked process against
    // the same table queues up behind it too — confirmed against a real
    // Postgres container as a genuine race (repeated full-suite runs gave
    // different failure counts, not a stable flake). `fileParallelism: false`
    // serializes file execution (each file still runs its own tests
    // normally; only the process-level scheduling is affected), which
    // removes the shared-table contention between files entirely. Same fix
    // fleet-wide for the same class of bug: trade-service hit this via a
    // TRUNCATE race (PR #1022, services/trade-service/vitest.config.ts) and
    // used this exact setting.
    fileParallelism: false,
  },
});
