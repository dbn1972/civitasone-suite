import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // buildApp() + inject under parallel CI load regularly exceeds the 5s default.
    testTimeout: 30_000,
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://stock_svc:stock_dev_pw@localhost:5435/civitas_stock",
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
