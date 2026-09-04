import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Wave 3 cross-service wiring added a second real-DB integration test
    // file (tests/cross-events-integration.test.ts) alongside
    // tests/parking-lifecycle.test.ts. Both hit the SAME live civitas_parking
    // Postgres database (not a per-file sandbox), and parking-lifecycle.test.ts's
    // beforeAll TRUNCATEs every parking/_outbox/_inbox table unconditionally —
    // vitest's default file parallelism would let that TRUNCATE race against
    // the other file's inserts/outbox-relay mid-test (reproduced against a
    // real Postgres container: default `vitest run` intermittently failed
    // cross-events-integration.test.ts with rows read back as undefined,
    // wiped by the concurrently-running TRUNCATE — not an RNG collision).
    // Folding cross-events-integration.test.ts into parking-lifecycle.test.ts
    // was considered first (that file's own header documents the one-file
    // convention this is normally supposed to follow), but the cross-events
    // file needs meaningfully different fixtures — dynamic imports of
    // finance-service's and notification-service's own db/consumer/schema
    // modules with process.env.DATABASE_URL swapped per import, a different
    // tenant fixture (the platform default tenant finance's migration 0070
    // seeds), and its own tenant-wrapped MemoryQueue helper — that would
    // clutter the main lifecycle file rather than clarify it. Serializing
    // file execution (still parallel WITHIN a file) is the standard fix for
    // a multi-file suite sharing one real database; cheap here since this
    // service now has exactly two DB-touching files. Same fix fleet-wide for
    // the same class of bug: trade-service hit this via a TRUNCATE race (PR
    // #1022, services/trade-service/vitest.config.ts) and used this exact
    // setting.
    fileParallelism: false,
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://parking_svc:parking_dev_pw@localhost:5435/civitas_parking",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    coverage: {
      provider: "v8",
      exclude: ["dist/**", "src/index.ts", "src/worker.ts"],
    },
  },
});
