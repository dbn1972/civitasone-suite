import { defineConfig } from "vitest/config";
import { sharedTestTimeouts } from "../../vitest.shared";
import { testDbFromEnv, testDbHostPort } from "../../vitest.testdb";

// CI bootstrap sets civitas_admin's password from PGPASSWORD/POSTGRES_ADMIN_PASSWORD
// (civitas_test). Local compose defaults to civitas_dev_pw. Silo provisioning
// integration tests must use the same password or CREATE DATABASE fails auth.
// Turbo 2 strict mode strips undeclared env — PGPASSWORD is listed in
// turbo.json test.passThroughEnv. Also fall back to civitas_test when CI=true
// so a direct `vitest run` in GHA still authenticates if pass-through is missed.
const adminPw =
  process.env.POSTGRES_ADMIN_PASSWORD ??
  process.env.PGPASSWORD ??
  (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
    ? "civitas_test"
    : "civitas_dev_pw");
// FQ15: PGHOST/PGPORT and the runner DSN are injected ONLY when the caller set
// them. Never a default host/port: on the shared host 5435 is the LIVE database.
const testDb = testDbFromEnv();
const provisioningRunnerDsn =
  process.env.PROVISIONING_RUNNER_DSN ??
  (testDb
    ? `postgres://civitas_admin:${encodeURIComponent(adminPw)}@${testDb.host}:${testDb.port}/civitas_install`
    : undefined);
const testDbEnv = {
  ...(provisioningRunnerDsn ? { PROVISIONING_RUNNER_DSN: provisioningRunnerDsn } : {}),
  ...(testDb ? { PGHOST: testDb.host, PGPORT: testDb.port } : {}),
};

export default defineConfig({
  test: {
    ...sharedTestTimeouts,
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? `postgres://install_svc:install_dev_pw@${testDbHostPort()}/civitas_install`
          : (() => {
              throw new Error(
                "REL-035: DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      ...testDbEnv,
      POSTGRES_ADMIN_PASSWORD: adminPw,
      PGPASSWORD: adminPw,
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
        "**/*.config.{ts,js,mjs,cjs}",
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
