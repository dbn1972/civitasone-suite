import { defineConfig } from "vitest/config";

// Wave 3 cross-events wiring added tests/municipal-status-notification-integration.test.ts,
// which flips process.env.DATABASE_URL between two real cross-service DB
// connections (this service's own civitas_parks and notification-service's
// civitas_notification) inside one file -- the same dual-DSN dynamic-import
// technique building-service's equivalent test uses. That file's own
// vitest.config.ts documents the concrete failure mode this causes under
// vitest's default `threads` pool (Node module state, e.g. @civitasone/db's
// internal client caches, leaking across test files reusing the same worker)
// and under default file parallelism (shared-table lock contention between
// concurrently-running real-DB test files). Applying the same fix here
// pre-emptively rather than waiting to reproduce it locally first: `forks`
// with `singleFork: false` gives every test file its own OS process, and
// `fileParallelism: false` serializes file execution so this service's
// other real-DB suites (assets/complaints/inspections/number-sequences/
// rls-isolation/tree-requests) don't race the new cross-service file over
// shared civitas_parks tables.
export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://parks_svc:parks_dev_pw@localhost:5435/civitas_parks",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      // Required by notification-service's real deliveries consumer
      // (at-rest PII encryption) -- only exercised by
      // tests/municipal-status-notification-integration.test.ts, which
      // dynamically imports notification-service's real modules for a
      // genuine cross-service, real-DB proof. Test-only value; production
      // injects the real key from the secret manager.
      NOTIFICATION_PII_KEY: "test_notification_pii_key_32chars",
    },
    pool: "forks",
    poolOptions: {
      forks: {
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
