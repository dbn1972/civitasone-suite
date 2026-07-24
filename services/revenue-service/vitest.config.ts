import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://revenue_svc:revenue_dev_pw@localhost:5435/civitas_revenue",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "src/worker.ts", "src/shared/db.ts", "src/shared/infra.ts", "src/shared/outbox.ts"],
      thresholds: {
        lines: 99,
        functions: 97,
        branches: 92,
        statements: 99,
      },
    },
  },
});
