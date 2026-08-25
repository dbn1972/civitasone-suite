import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Property-based tests (fast-check) live in tests/properties/*.prop.ts
    // per the design doc's test organization; unit/integration tests use
    // the standard *.test.ts suffix. Both patterns are discovered here.
    include: ["tests/**/*.test.ts", "tests/**/*.prop.ts"],
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://visitor_svc:visitor_dev_pw@localhost:5435/civitas_visitor",
      // Cross-tenant maintenance workers read through the BYPASSRLS scanner role
      // (migration 0009). Integration tests exercise the real cross-tenant scan.
      VISITOR_SCANNER_DATABASE_URL:
        process.env.VISITOR_SCANNER_DATABASE_URL ??
        "postgres://visitor_scanner:visitor_scanner_dev_pw@localhost:5435/civitas_visitor",
      // At-rest PII encryption key — required for encryptedText() inserts/reads
      // in integration tests that touch visit_requests / blacklist rows.
      VISITOR_PII_KEY:
        process.env.VISITOR_PII_KEY ?? "dev_visitor_pii_master_key_32chars",
      // RS256 PKCS8 dev signing key for digital-pass QR generation — used by
      // visit-request/consumer.ts's triggerPassGenerate() (approving a visit
      // request cascades to digital-pass generation) when no per-tenant key
      // store is configured. Throwaway key, dev/test only.
      VISITOR_TENANT_SIGNING_KEY_PEM:
        process.env.VISITOR_TENANT_SIGNING_KEY_PEM ??
        "-----BEGIN PRIVATE KEY-----\n" +
        "MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCwOlzlsUWbgAia\n" +
        "GLSVjzJbLfT6sOdtcnWReilTL36HUHtj/IisFd2XMuUgZjIUEY4ZCFoLTAabHXii\n" +
        "mwxrcg+5Ky9FZ9NotHfp4X16R9OJkOaWJoqteoH3kLfUbAszwm6dqOTDr8aSBbvd\n" +
        "1pGExgQsEnGhCaa/R8aLo+03d9vTfUGPociUqnPArLuLV6Zs7EA3BhX5Xs7yWvQp\n" +
        "6wQWciAO4QuYTyUrN0n7WMZmPyMtPf7hKK058IXbXG02uLVyJMYmeFrkZwBX1G1N\n" +
        "bAWgpC4QrubSiRmqaArJphzkzXFx8gIFcf6oNcv0cRZsMrCDlXj7cJxKTjPwEON4\n" +
        "33yB7jzZAgMBAAECggEASUCBQ+LLfccbDD6vtak3s8nnFlt5XzegIg/m5JKN5B4y\n" +
        "pA2hG/Lc0JARyMViFJB1gfdEQoTgDBMUhXawk2rumTgXpqBxMoktfRTDTRRVHE4U\n" +
        "Yx5zL4gIRQktOImOoH218Cf3q1XB0wm6HQynIUsUCePCwr8ZxlHF+F5z6MYUJJSu\n" +
        "xdlHcdH7pie/VGnVQ/68S3DpGHJZ9HSh2EZEKLRPoAiGw+IN+mZCLSGd41nW1p+o\n" +
        "YdPEuPJ7JymaRuUigFuWWP/oz3tYVxa9GxEgvEMdEKtmH5Np0XpYc16VQZOIH1EO\n" +
        "gQlWH0Zxl8+QvGRE9ptMu8VBSQQgAOaIbOtX6uQQ7wKBgQDwJ5i/T3QD0BaFZUzN\n" +
        "52tWnWduotNRaio3ckIic3TmYa6TYBythnaeHw085NuXtA/8IIQu1OSEq92CgcwG\n" +
        "4uHGJCz6Uu9hSQcA6t9pHj21klUnlud/2C4gU1QqWsyMDhb+NOg9/AFkpgHlnv7b\n" +
        "y4h8eNpck42ZprsMRsegRUu8twKBgQC72v5YCLGjSAV6KTUwXGFi2BGDbCU24krG\n" +
        "Tb2BMiP0JX3/pY1PE0c6SMWBkwVfFcATLLYn3apoHm/hqptj8bG5KTO6+imcOaFm\n" +
        "ONnGhrvhfQQ34JkY4U/wfRYAA3QA1jAI/KyzPiHMQX9OiRIxt5B1NvYS7FZa7cQ1\n" +
        "16GMWN1i7wKBgA1tKU0I1COibp/mmfSpC4c8JZw53jafCN0wtiHW8qIus+Ppa7EH\n" +
        "43nTopnU8bH5jys5Zip4HI6OTUQOnamE5bp+K0WTfW6i9pFGkFcAKdMM61XbSfYL\n" +
        "0AheoEX97ZGm+AIeUx2kCS/nWBPOX9FJ/8d1uj+SwEfm2m5FRsPfG+zhAoGAIUdo\n" +
        "a3wOzBhEMCIAtDKJZhNU9u0/ontwN7Up7ytMx0GlEpbnc6y8n4yowI2lE/Usc7km\n" +
        "A+X2/D74Hwg0Qv5cN6se6O7MVEq5VvyXR94yhn25M5TsSkYP/VCLhzEVadiH5e+t\n" +
        "QIuvPRoVTXpm6LvWMY2tBiksGyun6MnsaoqLna0CgYEA6jUAnEYwrTgZkEyaEO4d\n" +
        "DKQhmHl+6VrIOp9nWnXdQZf1aP9M/VSgujVPD3/LZRLMgbS2nd/L+u+8aBa/SuNF\n" +
        "ZRdeX+nLdxxFth7P0qlgcBQSbmfJAHR4YN0KE5ul2yWT1jGsn29B8thcdQUp6luV\n" +
        "aNpUjUg7xGjPYqA9AmwmwJ8=\n" +
        "-----END PRIVATE KEY-----\n",
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
