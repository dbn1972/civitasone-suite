import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://shop_svc:shop_dev_pw@localhost:5435/civitas_shop"
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
      // (lines 73.35 / branches 81.21 / functions 75.43 / statements
      // 73.35, via `pnpm --filter @civitasone/shop-service run coverage`
      // against a fully migrated, isolated Postgres, 27/27 tests passing),
      // matching the convention used by every other service's
      // vitest.config.ts (e.g. hrms-service).
      thresholds: {
        lines: 73,
        functions: 75,
        branches: 81,
        statements: 73,
      },
    },
  },
});
