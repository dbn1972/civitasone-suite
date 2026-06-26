import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://citizen_svc:citizen_dev_pw@localhost:5435/civitas_citizen",
      DB_URL: process.env.DB_URL ?? process.env.DATABASE_URL ?? "postgres://citizen_svc:citizen_dev_pw@localhost:5435/civitas_citizen",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      CITIZEN_PII_KEY: "test_pii_master_key_for_vitest_32",
      CITIZEN_PII_SALT: "civitas-citizen-pii",
    },
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
});
