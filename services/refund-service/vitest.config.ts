import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Without a config of its own this service picked up the repo-root
    // vitest.config.mjs, whose DATABASE_URL defaults to civitas_finance --
    // so every refund-service DB-integration test connected to the wrong
    // database and failed with "relation refund.refund_requests does not
    // exist" (the schema genuinely exists, just in civitas_refund, not
    // civitas_finance). Mirrors the identical fix already applied to
    // cdp-service/vitest.config.ts. DB/role match
    // scripts/ci/bootstrap-postgres.sh's SERVICE_DBS[refund-service] entry
    // (refund_svc:civitas_refund) and its <role>_dev_pw convention.
    include: ["tests/**/*.test.ts"],
    passWithNoTests: false,
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://refund_svc:refund_dev_pw@localhost:5435/civitas_refund",
    },
    // Wave 3 cross-events wiring added
    // tests/cross-events-integration.test.ts, which dynamically imports a
    // SECOND service's real db.ts/consumer/schema modules
    // (notification-service) after temporarily swapping
    // process.env.DATABASE_URL to that service's own connection
    // (createTenantDb() reads DATABASE_URL once at import time, so this
    // env-var swap is the only way to reach another service's real
    // database from inside one test file). The default `threads` pool
    // reuses a small set of worker threads across test files, so Node
    // module state (@civitasone/db's internal client caches, keyed off
    // DATABASE_URL at import time) can leak across files that land in the
    // same thread -- the exact flakiness class already hit and fixed the
    // same way by animal-service, building-service, sewerage-service,
    // trade-service, parking-service and advertisement-service (see their
    // own vitest.config.ts comments) when they added their own Wave 3
    // dual-DSN integration test. `pool: "forks"` gives every test file its
    // own OS process, removing the shared module state entirely;
    // `fileParallelism: false` serializes file execution on top of that
    // (each file still runs its own tests normally, only the process-level
    // schedule changes) -- this test file's DATABASE_URL flips are
    // process-wide for the file, not test-scoped, so a concurrently-running
    // sibling file must not observe them.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
    fileParallelism: false,
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      exclude: ["dist/**", "src/index.ts", "src/worker.ts", "vitest.config.ts"],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 65,
        statements: 80,
      },
    },
  },
});
