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
    // leak across files that ran in the same worker. Same root cause and
    // same fix as building-service's vitest.config.ts (see its comment):
    // confirmed here too -- the notification integration test passed 6/6 in
    // isolation against a fresh DB, but flaked intermittently as part of the
    // full suite under the default threads pool. `pool: "forks"` gives every
    // test file its own OS process, removing the leak entirely.
    pool: "forks",
    poolOptions: {
      forks: {
        // Explicit: vitest's own forks-pool default can still coalesce
        // fast-exiting test files onto a single fork under some configs,
        // which reintroduces the same cross-file leak this pool switch is
        // meant to remove. Force one OS process per test file.
        singleFork: false,
      },
    },
    coverage: {
      provider: "v8",
      exclude: ["dist/**", "src/index.ts", "src/worker.ts"],
    },
  },
});
