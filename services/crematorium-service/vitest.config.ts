import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://crematorium_svc:crematorium_dev_pw@localhost:5435/civitas_crematorium",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    // Wave 3 cross-events wiring added two new real-Postgres integration
    // files (tests/municipal-fee-challan-integration.test.ts,
    // tests/municipal-status-notification-integration.test.ts), each of
    // which dynamically imports a SECOND service's real db.ts/consumer/
    // schema modules after temporarily swapping process.env.DATABASE_URL to
    // that service's own connection (createTenantDb() reads DATABASE_URL
    // once at import time, so this is the only way to reach a second
    // service's real database from inside one test file). This service
    // already had four real-DB integration files (bookings, facilities,
    // records, tenant-isolation — PR #1017, including a real CAS-under-
    // concurrency test and raw-SQL RLS tests) before this pair, for six
    // total.
    //
    // Multiple other Wave 3 services independently hit the identical
    // failure mode under vitest's default parallel file execution: the
    // default `threads` pool reuses a small set of worker threads across
    // test files, so Node module state (@civitasone/db's internal client
    // caches, keyed off DATABASE_URL at import time) can leak across files
    // that land in the same worker — a file that flips DATABASE_URL
    // mid-run can hang a LATER file's beforeAll ("Hook timed out") if they
    // share a thread. `pool: "forks"` gives every test file its own OS
    // process, removing the shared module state entirely.
    //
    // `fileParallelism: false` serializes file execution on top of that —
    // each file still runs its own tests normally, only the process-level
    // schedule changes. Needed here because the two new files share the
    // platform default tenant ("00000000-0000-0000-0000-000000000001",
    // required — it's the only tenant finance-service's migration 0070 and
    // notification-service's migration 0044 seed their respective municipal
    // fixtures for) and each file's afterAll does a tenant-scoped (not
    // id-scoped) `DELETE FROM outbox WHERE tenantId = TENANT` cleanup — run
    // concurrently, one file's cleanup could delete the other file's
    // not-yet-relayed outbox row. Applied proactively here — the same fix
    // sewerage-service (PR #1029), trade-service (PR #1022) and
    // parking-service (PR #1026) each needed for this identical risk.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
    fileParallelism: false,
    coverage: {
      provider: "v8",
      exclude: ["dist/**", "src/index.ts", "src/worker.ts"],
    },
  },
});
