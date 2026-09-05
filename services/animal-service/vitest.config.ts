import { defineConfig } from "vitest/config";

// building-service had no local vitest config, so it silently inherited the
// repo root's `include: ["tests/**/*.test.ts"]` fallback (vitest.config.mjs)
// — which doesn't match this service's tests, co-located under src/modules/**
// the same way every other properly-configured service in this monorepo does
// (see e.g. services/hrms-service/vitest.config.ts). That's very likely *why*
// this service had zero test coverage: any test file placed the normal way
// would have been silently skipped ("No test files found") rather than run.
// This file intentionally omits `include` so vitest falls back to its own
// built-in default (`**/*.{test,spec}.ts`), which picks up both the
// co-located module tests AND the top-level tests/ directory added in this
// pass (mirroring swm-service/trade-service's DB-backed integration suite
// convention) without needing a second config.
export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      // Same convention as every other DB-backed service's vitest config
      // (e.g. services/swm-service/vitest.config.ts,
      // services/sewerage-service/vitest.config.ts): default to the CI
      // bootstrap's role/db for this service (see
      // infra/db/bootstrap/bootstrap_municipal_services.sql and
      // scripts/ci/bootstrap-postgres.sh's SERVICE_DBS[animal-service]),
      // overridable via a real DATABASE_URL env var for local runs against
      // an isolated container.
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://animal_svc:animal_dev_pw@localhost:5435/civitas_animal",
    },
    // Wave 3 cross-events wiring added tests/cross-events-integration.test.ts,
    // which dynamically imports a SECOND and THIRD service's real db.ts/
    // consumer/schema modules (finance-service, notification-service) after
    // temporarily swapping process.env.DATABASE_URL to each one's own
    // connection in turn (createTenantDb() reads DATABASE_URL once at
    // import time, so this env-var swap is the only way to reach another
    // service's real database from inside one test file).
    //
    // Confirmed against this exact service, the same way building-service
    // and sewerage-service already found it (see
    // services/sewerage-service/vitest.config.ts for the full writeup):
    // the default `threads` pool reuses a small set of worker threads
    // across test files, so Node module state (@civitasone/db's internal
    // client caches, keyed off DATABASE_URL at import time) can leak across
    // files that land in the same thread — running the full suite
    // (`vitest run`, no flags) alongside the six pre-existing test files
    // made cross-events-integration.test.ts's notification-service
    // assertion fail deterministically (a delivery row this test had just
    // caused to be written was never found), even though the same file
    // passed cleanly every time run in isolation. `pool: "forks"` gives
    // every test file its own OS process, removing the shared module state
    // entirely; `fileParallelism: false` serializes file execution on top
    // of that (each file still runs its own tests normally, only the
    // process-level schedule changes) — this test file's DATABASE_URL
    // flips are process-wide for the file, not test-scoped, so a
    // concurrently-running sibling file must not observe them. Same fix
    // fleet-wide for this class of bug: trade-service (PR #1022),
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
