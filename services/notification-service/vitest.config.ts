import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://notification_svc:notification_dev_pw@localhost:5435/civitas_notification",
      // Cross-tenant sweepers read through the BYPASSRLS scanner role (migration 0024).
      NOTIFICATION_SCANNER_DATABASE_URL:
        process.env.NOTIFICATION_SCANNER_DATABASE_URL ??
        "postgres://notification_scanner:notification_scanner_dev_pw@localhost:5435/civitas_notification",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      NOTIFICATION_EMAIL_DRIVER: "stub",
      NOTIFICATION_IN_APP_DRIVER: "memory",
      NOTIFICATION_SMS_DRIVER: "stub",
      NOTIFICATION_WHATSAPP_DRIVER: "stub",
    },
    coverage: {
      provider: "v8",
      exclude: ["dist/**", "src/index.ts", "src/worker.ts"],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 65,
        statements: 80,
      },
    },
  },
});
