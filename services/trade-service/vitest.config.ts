import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Wave 3 cross-service wiring added a second real-DB integration test
    // file (tests/cross-service-integration.test.ts) alongside
    // tests/trade-lifecycle.test.ts. Both hit the SAME live civitas_trade
    // Postgres database (not a per-file sandbox), and trade-lifecycle.test.ts's
    // beforeAll TRUNCATEs every trade/_outbox/_inbox table unconditionally —
    // vitest's default file parallelism would let that TRUNCATE race against
    // the other file's inserts/outbox-relay mid-test. Serializing file
    // execution (still parallel WITHIN a file) is the standard fix for a
    // multi-file suite sharing one real database; cheap here since this
    // service now has exactly two DB-touching files.
    fileParallelism: false,
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://trade_svc:trade_dev_pw@localhost:5995/civitas_trade",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    coverage: {
      provider: "v8",
      exclude: ["dist/**", "src/index.ts", "src/worker.ts"],
    },
  },
});
