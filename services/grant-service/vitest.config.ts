import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://grant_svc:grant_dev_pw@localhost:5435/civitas_grant"
          : (() => {
              throw new Error(
                "REL-035: DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      // domain.maskAadhaar requires AADHAAR_HMAC_KEY (fail-closed DPDP); salt alone is ignored
      AADHAAR_HMAC_KEY:
        process.env.AADHAAR_HMAC_KEY ??
        "test-aadhaar-hmac-key-for-unit-tests-only",
      AADHAAR_SALT: "test-aadhaar-salt-for-unit-tests",
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
