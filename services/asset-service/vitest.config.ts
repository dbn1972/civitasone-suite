import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://asset_svc:asset_dev_pw@localhost:5435/civitas_asset",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "src/modules/register/consumer.ts",
        "src/modules/lifecycle/eoffice-consumer.ts",
        "src/modules/lifecycle/consumer.ts",
        "src/modules/depreciation/consumer.ts",
        "src/modules/maintenance/consumer.ts",
        "src/modules/insurance/consumer.ts",
        "src/modules/enterprise/consumer.ts",
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
