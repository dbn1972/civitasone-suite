import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    // REL-024: buildApp() registers 11+ route modules (users, rbac, sessions,
    // mfa, devices, sync, api-keys, break-glass, saml, scim, webauthn) and
    // legitimately takes >10s to complete when the CI test job runs all
    // ~115 packages concurrently via turbo test --continue against one
    // shared Postgres container (verified: every file here passes 100% in
    // isolation -- 34/34 files, 416/416 tests -- so this is CI-load
    // contention hitting vitest's 10s default hookTimeout, not a code bug).
    // saml-config.route.test.ts and sessions-apikeys-routes.test.ts were the
    // two observed victims ("Hook timed out in 10000ms" in beforeAll's
    // buildApp() call); raised for the whole file since any beforeAll here
    // can be scheduled at the same contention point.
    hookTimeout: 30_000,
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://identity_svc:identity_dev_pw@localhost:5435/civitas_identity"
          : (() => {
              throw new Error(
                "REL-035: DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      DB_URL:
        process.env.DB_URL ??
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://identity_svc:identity_dev_pw@localhost:5435/civitas_identity"
          : (() => {
              throw new Error(
                "REL-035: DB_URL (or DATABASE_URL) is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DB_URL (or DATABASE_URL) explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      IDENTITY_SCANNER_DATABASE_URL:
        process.env.IDENTITY_SCANNER_DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://identity_scanner:identity_scanner_dev_pw@localhost:5435/civitas_identity"
          : (() => {
              throw new Error(
                "REL-035: IDENTITY_SCANNER_DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export IDENTITY_SCANNER_DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      SCIM_BEARER_TOKEN: "test-scim-bearer-token-for-coverage",
      SCIM_TENANT_ID: "aaaaaaaa-1111-4000-8000-000000000099",
      MFA_ENC_KEY: "test-mfa-encryption-key-at-least-16",
      INTERNAL_SERVICE_SECRET: "test-internal-service-secret-32chr",
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
