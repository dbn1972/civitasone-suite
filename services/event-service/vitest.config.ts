import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://event_svc:event_dev_pw@localhost:5435/civitas_event",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      // Required by notification-service's real deliveries consumer
      // (at-rest PII encryption) -- only exercised by this service's own
      // tests/municipal-status-notification-integration.test.ts, which
      // dynamically imports notification-service's real modules for a
      // genuine cross-service, real-DB proof. Test-only value; production
      // injects the real key from the secret manager.
      NOTIFICATION_PII_KEY: "test_notification_pii_key_32chars",
    },
    // The default `threads` pool runs test files inside a small set of
    // REUSED worker threads, so Node module state (e.g. @civitasone/db's
    // internal client caches, and process.env.DATABASE_URL mutations made
    // by tests/municipal-fee-challan-integration.test.ts and
    // tests/municipal-status-notification-integration.test.ts to flip
    // between event's and finance's/notification's real DB connections) can
    // leak across files that ran in the same worker. `pool: "forks"` +
    // `singleFork: false` (the fix originally applied here, mirroring
    // building-service's config) was NOT sufficient on its own: independently
    // re-verifying after that fix landed, the notification-integration test
    // still failed intermittently (~1-in-5 to 1-in-10 full-suite runs,
    // "expected 0 to be greater than 0" -- zero delivery rows, zero DLQ
    // entries, meaning notification-service's handler never ran at all).
    // Traced with direct DB queries: the notification.send outbox row WAS
    // marked published (relay succeeded), but _inbox.processed held no row
    // for its messageId either -- the handler was never invoked. Reproduced
    // in isolation down to exactly the two files that both flip
    // `process.env.DATABASE_URL` mid-file (this file and
    // municipal-fee-challan-integration.test.ts): running just that pair
    // repeatedly reproduces the same intermittent failure, landing on
    // EITHER file depending on the run -- proving vitest's forks pool can
    // still occasionally coalesce two "fast" files onto the same OS process
    // despite `singleFork: false`, at which point the second file's dynamic
    // `import("../src/shared/db.js")` returns the FIRST file's already-cached
    // module (bound to whichever DATABASE_URL was active when that import
    // first ran), not a fresh one for its own DSN.
    // `fileParallelism: false` is the fix already proven effective for this
    // exact class of shared-state leak across several other Wave 3 services
    // tonight (trade-service PR #1022, parking-service PR #1026, etc.) --
    // it fully serialises FILE EXECUTION (not just OS-process isolation),
    // so two files' state can never interleave regardless of the pool's own
    // scheduling. Kept alongside `pool: "forks"` for defense in depth.
    pool: "forks",
    poolOptions: {
      forks: {
        // Explicit: vitest's own forks-pool default can still coalesce
        // fast-exiting test files onto a single fork under some configs.
        // Kept as defense in depth even though fileParallelism: false below
        // is the fix that actually closed the leak (see comment above).
        singleFork: false,
      },
    },
    fileParallelism: false,
    coverage: {
      provider: "v8",
      exclude: ["dist/**", "src/index.ts", "src/worker.ts"],
    },
  },
});
