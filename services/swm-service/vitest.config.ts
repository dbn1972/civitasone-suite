import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://swm_svc:swm_dev_pw@localhost:5435/civitas_swm"
          : (() => {
              throw new Error(
                "REL-035: DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
    },
    coverage: {
      provider: "v8",
      exclude: ["dist/**", "src/index.ts", "src/worker.ts", "**/*.config.ts"],
      // REL-013: thresholds set at/just below real measured coverage
      // (lines 89.52 / branches 77.81 / functions 84.52 / statements
      // 89.52, via `pnpm --filter @civitasone/swm-service run coverage`
      // against a fully migrated, isolated Postgres, 21/21 tests passing),
      // matching the convention used by every other service's
      // vitest.config.ts (e.g. hrms-service).
      thresholds: {
        lines: 89,
        functions: 84,
        branches: 77,
        statements: 89,
      },
    },
  },
});
