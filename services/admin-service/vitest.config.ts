import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://admin_svc:admin_dev_pw@localhost:5435/civitas_admin",
      // Cross-tenant sftp lead-ingestion discovery reads through the
      // BYPASSRLS scanner role (migration 0030) — see
      // src/shared/scanner-db.ts and src/modules/lead-ingestion/scheduler.ts.
      ADMIN_SCANNER_DATABASE_URL:
        process.env.ADMIN_SCANNER_DATABASE_URL ??
        "postgres://admin_scanner:admin_scanner_dev_pw@localhost:5435/civitas_admin",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "src/modules/tenants/consumer.ts",
        "src/modules/config/consumer.ts",
        "src/modules/backup/consumer.ts",
        "src/modules/support/consumer.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 65,
        statements: 80,
      },
    },
  },
});
