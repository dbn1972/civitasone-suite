import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:  process.env.DATABASE_URL ?? "postgres://contract_svc:contract_dev_pw@localhost:5435/civitas_contract",
      QUEUE_DRIVER:  "memory",
      CACHE_DRIVER:  "memory",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "vitest.config.ts",
        "eslint.config.js",
        "src/modules/contracts/consumer.ts",
        "src/modules/contracts/eoffice-consumer.ts",
        "src/modules/rate/consumer.ts",
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
