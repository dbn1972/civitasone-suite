import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://procurement_svc:procurement_dev_pw@localhost:5435/civitas_procurement"
          : (() => {
              throw new Error(
                "REL-035: DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      FINANCE_SERVICE_URL: "http://localhost:3007",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "vitest.config.ts",
        "src/modules/clearance/consumer.ts",
        "src/modules/po/eoffice-consumer.ts",
        "src/modules/tender/eoffice-consumer.ts",
        "src/modules/auction/consumer.ts",
        "src/modules/indent/consumer.ts",
        "src/modules/payments/consumer.ts",
        "src/modules/security/consumer.ts",
        "src/modules/vendor/consumer.ts",
        "src/modules/planning/consumer.ts",
        "src/modules/po/amendment-consumer.ts",
        "src/modules/vendor/scorecard-consumer.ts",
        "src/modules/tender/docs-consumer.ts",
        "src/modules/gem/reconcile-consumer.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 74,
        branches: 65,
        statements: 80,
      },
    },
  },
});
