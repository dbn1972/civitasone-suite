import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://crm_svc:crm_dev_pw@localhost:5435/civitas_crm",
      // Cross-tenant maintenance workers read through the BYPASSRLS scanner role
      // (migration 0089). Integration tests exercise the real cross-tenant scan.
      CRM_SCANNER_DATABASE_URL:
        process.env.CRM_SCANNER_DATABASE_URL ??
        "postgres://crm_scanner:crm_scanner_dev_pw@localhost:5435/civitas_crm",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "src/modules/contacts/consumer.ts",
        "src/modules/deals/consumer.ts",
        "src/modules/activities/consumer.ts",
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
