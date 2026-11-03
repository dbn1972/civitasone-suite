import { defineConfig } from "vitest/config";
import { sharedTestTimeouts } from "../../vitest.shared";
import { testDbHostPort } from "../../vitest.testdb";

export default defineConfig({
  test: {
    ...sharedTestTimeouts,
    // Several real-DB test files here (municipal-challan-integration,
    // recon-db, recon-idempotency-db, rls-isolation, distribution-lock-race,
    // masters-opening-balance-consumer, ...) write/relay through the SAME
    // shared _outbox.messages table with no per-file isolation. Under
    // default parallelism, one file's relay/TRUNCATE-style operation can race
    // another concurrently-running file's writes to that table — a real bug,
    // not environment noise (see .claude/skills/16-production-readiness-audit
    // .md Section 4a). Bare `vitest run` in CI uses default parallelism, so a
    // fix only verified under --no-file-parallelism proves nothing about what
    // CI actually sees; serialising file execution here is the fix that holds
    // regardless of the pool's scheduling.
    fileParallelism: false,
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      PII_ENC_KEY: "test_pii_enc_key_for_finance_32c",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? `postgres://finance_svc:finance_dev_pw@${testDbHostPort()}/civitas_finance`
          : (() => {
              throw new Error(
                "REL-035: DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      DB_URL:
        process.env.DB_URL ??
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? `postgres://finance_svc:finance_dev_pw@${testDbHostPort()}/civitas_finance`
          : (() => {
              throw new Error(
                "REL-035: DB_URL (or DATABASE_URL) is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DB_URL (or DATABASE_URL) explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      // UAT Phase 2 C7: bill reads resolve procurement vendor names over HTTP. On a
      // shared dev/UAT host :3008 is the LIVE procurement-service; a closed port keeps
      // tests on the fail-open path (tests that need an answer stub fetch).
      PROCUREMENT_SERVICE_URL: "http://127.0.0.1:9",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "src/modules/integrations/**",
        "src/modules/tenant-onboard/**",
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
