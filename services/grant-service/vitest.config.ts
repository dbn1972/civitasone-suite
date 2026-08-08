import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:  process.env.DATABASE_URL ?? "postgres://grant_svc:grant_dev_pw@localhost:5435/civitas_grant",
      QUEUE_DRIVER:  "memory",
      CACHE_DRIVER:  "memory",
      // domain.maskAadhaar requires AADHAAR_HMAC_KEY (fail-closed DPDP); salt alone is ignored
      AADHAAR_HMAC_KEY: process.env.AADHAAR_HMAC_KEY ?? "test-aadhaar-hmac-key-for-unit-tests-only",
      AADHAAR_SALT:  "test-aadhaar-salt-for-unit-tests",
    },
    coverage: {
      provider: "v8",
      exclude: ["src/index.ts", "src/worker.ts"],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 65,
        statements: 80,
      },
    },
  },
});
