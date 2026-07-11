import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://court_svc:court_dev_pw@localhost:5435/civitas_court",
      DB_URL: process.env.DB_URL ?? process.env.DATABASE_URL ?? "postgres://court_svc:court_dev_pw@localhost:5435/civitas_court",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      COURT_PII_KEY: "test_pii_master_key_for_vitest_32",
      COURT_PII_SALT: "civitas-court-pii-salt-for-vitest",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "**/*.config.ts",
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
