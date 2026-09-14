import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Wave 3 cross-service wiring added a second real-DB integration test
    // file (tests/cross-service-integration.test.ts) alongside
    // tests/trade-lifecycle.test.ts. Both hit the SAME live civitas_trade
    // Postgres database (not a per-file sandbox), and trade-lifecycle.test.ts's
    // beforeAll TRUNCATEs every trade/_outbox/_inbox table unconditionally —
    // vitest's default file parallelism would let that TRUNCATE race against
    // the other file's inserts/outbox-relay mid-test. Serializing file
    // execution (still parallel WITHIN a file) is the standard fix for a
    // multi-file suite sharing one real database; cheap here since this
    // service now has exactly two DB-touching files.
    fileParallelism: false,
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://trade_svc:trade_dev_pw@localhost:5435/civitas_trade"
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
      // (lines 87.77 / branches 77.58 / functions 84.09 / statements
      // 87.77, via `pnpm --filter @civitasone/trade-service run coverage`
      // against a fully migrated, isolated Postgres, 43/43 tests passing),
      // matching the convention used by every other service's
      // vitest.config.ts (e.g. hrms-service).
      thresholds: {
        lines: 87,
        functions: 84,
        branches: 77,
        statements: 87,
      },
    },
  },
});
