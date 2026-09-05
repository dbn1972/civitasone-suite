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
    coverage: {
      provider: "v8",
      exclude: ["dist/**", "src/index.ts", "src/worker.ts"],
    },
  },
});
