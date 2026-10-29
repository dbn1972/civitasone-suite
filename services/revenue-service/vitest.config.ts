import { defineConfig } from "vitest/config";
import { sharedTestTimeouts } from "../../vitest.shared";
import { testDbHostPort } from "../../vitest.testdb";

export default defineConfig({
  test: {
    ...sharedTestTimeouts,
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? `postgres://revenue_svc:revenue_dev_pw@${testDbHostPort()}/civitas_revenue`
          : (() => {
              throw new Error(
                "REL-035: DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      // Owner decision #2: the legacy direct-write rate-config routes are closed by default
      // (409 RATE_CONFIG_REQUIRES_APPROVAL). The pre-existing route/consumer tests exercise
      // them as fixtures, so this suite re-opens them; rate-config-proposals.test.ts unsets it
      // to prove the default is closed.
      RATE_CONFIG_DIRECT_WRITE_ENABLED: "true",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: [
        "src/index.ts",
        "src/worker.ts",
        "src/shared/db.ts",
        "src/shared/infra.ts",
        "src/shared/outbox.ts",
        "**/*.config.{ts,js,mjs,cjs}",
      ],
      thresholds: {
        lines: 99,
        functions: 97,
        branches: 92,
        statements: 99,
      },
    },
  },
});
