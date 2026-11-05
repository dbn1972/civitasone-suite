import { defineConfig } from "vitest/config";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { sharedTestTimeouts } from "../../vitest.shared";
import { testDbHostPort } from "../../vitest.testdb";

export default defineConfig({
  test: {
    ...sharedTestTimeouts,
    setupFiles: ["./tests/setup-tax-config.ts", "./tests/setup-tenant-identity.ts"],
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
          ? `postgres://payroll_svc:payroll_dev_pw@${testDbHostPort()}/civitas_payroll`
          : (() => {
              throw new Error(
                "REL-035: DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      // GAP-PAYROLL-DISBURSEMENT-03: bank files are signed by default. Tests
      // that issue a file without injecting a provider use a throwaway dev key
      // file in the temp dir (generated on first use, mode 600) -- never the
      // developer's real ~/.civitasone-payroll-signing-key.
      PAYROLL_SIGNING_KEY_FILE: join(tmpdir(), `civitasone-payroll-test-signing-key-${process.pid}`),
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      // UAT P3 b19 D-15: Form 16 / 24Q / 26Q / 12BA refuse (422
      // FORM16_EMPLOYER_NOT_CONFIGURED) without a valid deductor. A tenant with
      // no documentIdentity falls back (single-tenant only) to this deployment-wide identity, so the
      // suites that build those returns for throwaway tenants get a valid one
      // (test values only; tests/uat-p3-b19-d15-* clears / overrides them).
      // The deductor is read from tenant-service: point it at a dead port so a
      // test never reaches a real tenant-service on the host (tests stub fetch).
      TENANT_SERVICE_URL: "http://127.0.0.1:1",
      // The env fallback is honoured only on an explicitly single-tenant deployment
      // (repo.ts); the read of tenant-service itself fails closed (503).
      PAYROLL_DEDUCTOR_ENV_FALLBACK: "single-tenant",
      EMPLOYER_NAME: "Test Pay and Accounts Office",
      EMPLOYER_TAN: "TSTP12345T",
      EMPLOYER_PAN: "AAAGT1234T",
    },
    coverage: {
      provider: "v8",
      reportOnFailure: true,
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "src/modules/**/consumer.ts",
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
