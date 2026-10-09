import { configDefaults, defineConfig } from "vitest/config";
import { sharedTestTimeouts } from "../../vitest.shared";
export default defineConfig({
  test: {
    ...sharedTestTimeouts,
    // sec-021 spawns a real hrms-service (tsx src/index.ts) and waits up to 30s
    // for it to come up, which it misses under the turbo run's load. ci.yml's
    // Tests job runs it in its own step after `turbo test`, alone, with
    // GATEWAY_SPAWN_TESTS=1. Set the same locally to run it.
    exclude:
      process.env.GATEWAY_SPAWN_TESTS === "1"
        ? configDefaults.exclude
        : [...configDefaults.exclude, "tests/sec-021-actor-id-audit-log.integration.test.ts"],
    env: {
      NODE_ENV: "test",
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.GATEWAY_DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://gateway_svc:gateway_dev_pw@localhost:5435/civitas_gateway"
          : (() => {
              throw new Error(
                "REL-035: GATEWAY_DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export GATEWAY_DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      INTERNAL_SERVICE_SECRET: "test_internal_secret",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "**/*.d.ts", "**/*.config.{ts,js,mjs,cjs}"],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 75,
        branches: 65,
      },
    },
  },
});
