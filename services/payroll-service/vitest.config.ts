import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    testTimeout: 15000,
    setupFiles: ["./tests/setup-tax-config.ts"],
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      PII_ENC_KEY: "test_pii_key_for_civitasone_dev_32chars",
      // PERF-021 review follow-up: countQueriesDuring() (packages/db/src/pool.ts)
      // only counts queries when DB_QUERY_DEBUG=true was set before the sql
      // client was created -- without it queryCount is always 0 and
      // tests/perf-021-sitea-payroll-nplus1.test.ts's query-count assertions
      // (e.g. `expect(large.queryCount).toBe(small.queryCount)`) pass
      // regardless of whether the N+1 pattern is actually present. Set here
      // (test bootstrap), never in service env files -- see the `debug`
      // comment in createSqlClient(). Mirrors hrms-service/vitest.config.ts's
      // PERF-006 fix.
      DB_QUERY_DEBUG: "true",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://payroll_svc:payroll_dev_pw@localhost:5435/civitas_payroll"
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
      reportOnFailure: true,
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "src/modules/**/consumer.ts",
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
