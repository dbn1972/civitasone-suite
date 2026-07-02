import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://telephony_svc:telephony_dev_pw@localhost:5435/civitas_telephony",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      // At-rest PII key for caller/callee phone encryption (test-only value).
      TELEPHONY_PII_KEY: "test_telephony_pii_key_0123456789",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "src/modules/calls/consumer.ts",
        "src/modules/queues/consumer.ts",
        "src/modules/agents/consumer.ts",
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
