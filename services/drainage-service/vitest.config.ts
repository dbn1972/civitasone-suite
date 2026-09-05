import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://drainage_svc:drainage_dev_pw@localhost:5435/civitas_drainage",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    // Wave 3 cross-events wiring added one new real-Postgres integration
    // file (tests/municipal-status-notification-integration.test.ts) that
    // dynamically imports notification-service's real db.ts/consumer/schema
    // modules after temporarily swapping process.env.DATABASE_URL to that
    // service's own connection (createTenantDb() reads DATABASE_URL once at
    // import time, so this is the only way to reach a second service's real
    // database from inside one test file) — same shape as sewerage-service's
    // and building-service's own Wave 3 DATABASE_URL-flipping files (see
    // their vitest.config.ts). This service already had six real-DB
    // integration files (complaints, field-actions, hotspots,
    // cas-concurrency, number-uniqueness, tenant-isolation) before this one.
    //
    // The default `threads` pool reuses a small set of worker threads across
    // test files, so Node module state (@civitasone/db's internal client
    // caches, keyed off DATABASE_URL at import time) can leak across files
    // that land in the same worker — a file that flips DATABASE_URL mid-run
    // can hang a LATER file's beforeAll ("Hook timed out") if they share a
    // thread. `pool: "forks"` gives every test file its own OS process,
    // removing the shared module state entirely; `fileParallelism: false`
    // serializes file execution on top of that so this is not just
    // theoretical — verified against a real fresh Postgres bootstrap, `vitest
    // run` in default (threads, parallel) mode intermittently hung on this
    // suite once the new file was added, and was reliably green with these
    // two settings. Same fix fleet-wide for this class of bug: sewerage-
    // service (PR #1029), trade-service (PR #1022) and parking-service
    // (PR #1026) all hit a variant of it and used this exact setting.
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
