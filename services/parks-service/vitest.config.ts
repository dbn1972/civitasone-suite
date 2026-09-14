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
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://parks_svc:parks_dev_pw@localhost:5435/civitas_parks"
          : (() => {
              throw new Error(
                "REL-035: DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
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
      // REL-013: thresholds set at/just below real measured coverage
      // (lines 91.6 / branches 81.41 / functions 89.01 / statements 91.6,
      // via `pnpm --filter @civitasone/parks-service run coverage` against
      // a fully migrated, isolated Postgres, 45/45 tests passing --
      // PARKS_TEST_PGPORT must point at that instance for the
      // notification cross-service integration test), matching the
      // convention used by every other service's vitest.config.ts (e.g.
      // hrms-service).
      thresholds: {
        lines: 91,
        functions: 89,
        branches: 81,
        statements: 91,
      },
    },
  },
});
