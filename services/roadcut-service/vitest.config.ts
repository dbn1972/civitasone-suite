import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://roadcut_svc:roadcut_dev_pw@localhost:5435/civitas_roadcut"
          : (() => {
              throw new Error(
                "REL-035: DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    coverage: {
      provider: "v8",
      exclude: ["dist/**", "src/index.ts", "src/worker.ts"],
      // REL-013: thresholds set at/just below real measured coverage
      // (lines 96.34 / branches 86.12 / functions 95.78 / statements
      // 96.34, via `pnpm --filter @civitasone/roadcut-service run
      // coverage` against a fully migrated, isolated Postgres, 55/55 tests
      // passing -- ROADCUT_TEST_PGPORT must point at that instance for the
      // cross-service integration tests), matching the convention used by
      // every other service's vitest.config.ts (e.g. hrms-service).
      thresholds: {
        lines: 96,
        functions: 95,
        branches: 86,
        statements: 96,
      },
    },
  },
});
