import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://identity_svc:identity_dev_pw@localhost:5435/civitas_identity",
      DB_URL: process.env.DB_URL ?? process.env.DATABASE_URL ?? "postgres://identity_svc:identity_dev_pw@localhost:5435/civitas_identity",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      SCIM_BEARER_TOKEN: "test-scim-bearer-token-for-coverage",
      SCIM_TENANT_ID: "aaaaaaaa-1111-4000-8000-000000000099",
      MFA_ENC_KEY: "test-mfa-encryption-key-at-least-16",
      INTERNAL_SERVICE_SECRET: "test-internal-service-secret-32chr",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "src/index.ts",
        "src/worker.ts",
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
