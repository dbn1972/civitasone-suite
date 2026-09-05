import { defineConfig } from "vitest/config";

// Same root-cause fix as market-service (see that PR): no local vitest config
// meant this service silently inherited the repo root's
// include: ["tests/**/*.test.ts"] fallback, which doesn't match tests
// co-located under src/modules/** the way other properly-configured services
// in this monorepo work. This file intentionally omits `include` so vitest
// falls back to its own built-in default (`**/*.{test,spec}.ts`), which
// picks up both the co-located `src/modules/nocs/domain.test.ts` AND the new
// top-level `tests/` DB-backed integration suite added in this pass
// (mirroring animal-service's/swm-service's convention) without needing a
// second config.
export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      // Same convention as every other DB-backed service's vitest config
      // (e.g. services/animal-service/vitest.config.ts,
      // services/swm-service/vitest.config.ts): default to the CI
      // bootstrap's role/db for this service (see
      // scripts/ci/bootstrap-postgres.sh's SERVICE_DBS[fire-service]),
      // overridable via a real DATABASE_URL env var for local runs against
      // an isolated container.
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://fire_svc:fire_dev_pw@localhost:5435/civitas_fire",
    },
    // Wave 3 cross-events wiring added two new real-Postgres integration
    // files (tests/municipal-fee-challan-integration.test.ts,
    // tests/municipal-status-notification-integration.test.ts), each of
    // which dynamically imports a SECOND service's real db.ts/consumer/
    // schema modules after temporarily swapping process.env.DATABASE_URL to
    // that service's own connection (createTenantDb() reads DATABASE_URL
    // once at import time, so this is the only way to reach a second
    // service's real database from inside one test file). This service
    // already has a real-DB suite of 57 tests across 7 files (PR #1011).
    //
    // building-service/sewerage-service hit this exact situation (their own
    // DATABASE_URL-flipping cross-service files alongside an existing
    // real-DB suite) and found the default `threads` pool reuses a small set
    // of worker threads across test files, so Node module state
    // (@civitasone/db's internal client caches, keyed off DATABASE_URL at
    // import time) can leak across files that land in the same worker — a
    // file that flips DATABASE_URL mid-run can hang a LATER file's beforeAll
    // ("Hook timed out") if they share a thread. `pool: "forks"` gives every
    // test file its own OS process, removing the shared module state
    // entirely.
    //
    // `fileParallelism: false` serializes file execution on top of that —
    // each file still runs its own tests normally, only the process-level
    // schedule changes. Needed here because the two new files use the
    // platform default tenant ("00000000-0000-0000-0000-000000000001",
    // required — it's the only tenant finance-service's migration 0070 and
    // notification-service's migration 0044 seed their respective municipal
    // fixtures for) alongside this service's own existing DB-backed suite,
    // which creates/deletes real rows under vitest's default parallel file
    // execution — real CI runs bare `vitest run`, no override flags. Same
    // fix fleet-wide for this class of bug: trade-service (PR #1022),
    // parking-service (PR #1026), advertisement-service (PR #1030) and
    // sewerage-service (PR #1029) all hit a variant of it and used this
    // exact setting.
    pool: "forks",
    poolOptions: {
      forks: {
        singleFork: false,
      },
    },
    fileParallelism: false,
    coverage: {
      provider: "v8",
      exclude: ["dist/**", "src/index.ts", "src/worker.ts", "**/*.config.ts"],
    },
  },
});
