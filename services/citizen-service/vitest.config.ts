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
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "src/modules/portal/consumer.ts",
        "src/modules/application/consumer.ts",
        "src/modules/grievance/consumer.ts",
        "src/modules/rti/consumer.ts",
        "src/modules/helpdesk/consumer.ts",
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
