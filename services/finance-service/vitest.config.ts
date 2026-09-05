import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
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
      DATABASE_URL:  process.env.DATABASE_URL ?? "postgres://finance_svc:finance_dev_pw@localhost:5435/civitas_finance",
      DB_URL: process.env.DB_URL ?? process.env.DATABASE_URL ?? "postgres://finance_svc:finance_dev_pw@localhost:5435/civitas_finance",
      QUEUE_DRIVER:  "memory",
      CACHE_DRIVER:  "memory",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "src/modules/integrations/**",
        "src/modules/tenant-onboard/**",
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
