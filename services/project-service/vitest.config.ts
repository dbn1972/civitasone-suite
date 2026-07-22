import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:  process.env.DATABASE_URL ?? "postgres://project_svc:project_dev_pw@localhost:5435/civitas_project",
      QUEUE_DRIVER:  "memory",
      CACHE_DRIVER:  "memory",
      FINANCE_SERVICE_URL: "http://localhost:3007",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "**/*.config.ts",
        "**/*.config.js",
        "src/**/consumer.ts",
        "src/**/repo.ts",
        "src/**/commands.ts",
        "src/**/queries.ts",
        "src/modules/geo/domain.ts",
        "src/modules/utilisation/domain.ts",
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
