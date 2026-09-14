import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // buildApp() + inject under parallel CI load regularly exceeds the 5s default.
    testTimeout: 30_000,
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://stock_svc:stock_dev_pw@localhost:5435/civitas_stock"
          : (() => {
              throw new Error(
                "REL-035: DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "src/modules/item/consumer.ts",
        "src/modules/warehouse/consumer.ts",
        "src/modules/entry/consumer.ts",
        "src/modules/eway-bill/consumer.ts",
        "src/modules/eway-bill/nic-ewb-client.ts",
        "src/modules/receipt/repo.ts",
        "vitest.config.ts",
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
