import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Without a config of its own this service picked up the repo-root config,
    // whose DATABASE_URL addresses civitas_finance — so cdp integration tests
    // either skipped or ran against the wrong database.
    include: ["tests/**/*.test.ts"],
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      // Route tests assert on status codes, not on logs; per-request Pino output made
      // a failing run unreadable.
      LOG_LEVEL: "silent",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://cdp_svc:cdp_dev_pw@localhost:5435/civitas_cdp",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "vitest.config.ts",
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
