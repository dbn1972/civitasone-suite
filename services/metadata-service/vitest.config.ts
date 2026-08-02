import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://metadata_svc:metadata_dev_pw@localhost:5435/civitas_metadata",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      // At-rest PII key for the encryptedText() columns on
      // metadata.form_submissions (LM-002 lead capture). Test-only value; the
      // real key is injected from the secret manager as METADATA_PII_KEY.
      METADATA_PII_KEY: "test_metadata_pii_key_32_chars_min",
      // Keep the public-form rate limits high enough that the integration tests
      // are not throttled by each other; the limiter itself is unit-tested with
      // an injected clock in tests/forms-rate-limit.test.ts.
      METADATA_PUBLIC_FORM_IP_MAX: "500",
      METADATA_PUBLIC_FORM_MAX: "500",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 65,
        statements: 80,
      },
    },
  },
});
