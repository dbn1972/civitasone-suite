import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://install_svc:install_dev_pw@localhost:5435/civitas_install",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    coverage: {
      provider: "v8",
      include: ["src/**"],
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "src/modules/stages/consumer.ts",
        "src/modules/provisioning/consumer.ts",
        "src/modules/orchestrator/consumer.ts",
        "src/modules/orchestrator/repo.ts",
        "src/modules/stages/repo.ts",
        "src/modules/provisioning/repo.ts",
        "src/modules/orchestrator/schema.ts",
        "src/modules/provisioning/schema.ts",
        "src/modules/stages/schema.ts",
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
