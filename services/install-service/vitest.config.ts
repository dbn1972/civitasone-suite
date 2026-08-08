import { defineConfig } from "vitest/config";

// CI bootstrap sets civitas_admin's password from PGPASSWORD/POSTGRES_ADMIN_PASSWORD
// (civitas_test). Local compose defaults to civitas_dev_pw. Silo provisioning
// integration tests must use the same password or CREATE DATABASE fails auth.
const adminPw =
  process.env.POSTGRES_ADMIN_PASSWORD ?? process.env.PGPASSWORD ?? "civitas_dev_pw";
const pgHost = process.env.PGHOST ?? "localhost";
const pgPort = process.env.PGPORT ?? "5435";
const provisioningRunnerDsn =
  process.env.PROVISIONING_RUNNER_DSN ??
  `postgres://civitas_admin:${encodeURIComponent(adminPw)}@${pgHost}:${pgPort}/civitas_install`;

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://install_svc:install_dev_pw@localhost:5435/civitas_install",
      PROVISIONING_RUNNER_DSN: provisioningRunnerDsn,
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
        // Worker poll-loop wiring (task 7.7) — dedicated unit tests are task 7.8,
        // same convention as excluding consumer.ts (queue-driven wiring).
        "src/modules/provisioning/scheduler.ts",
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
