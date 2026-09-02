import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Without a config of its own this service picked up the repo-root
    // vitest.config.mjs, whose DATABASE_URL defaults to civitas_finance --
    // so every refund-service DB-integration test connected to the wrong
    // database and failed with "relation refund.refund_requests does not
    // exist" (the schema genuinely exists, just in civitas_refund, not
    // civitas_finance). Mirrors the identical fix already applied to
    // cdp-service/vitest.config.ts. DB/role match
    // scripts/ci/bootstrap-postgres.sh's SERVICE_DBS[refund-service] entry
    // (refund_svc:civitas_refund) and its <role>_dev_pw convention.
    include: ["tests/**/*.test.ts"],
    passWithNoTests: false,
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://refund_svc:refund_dev_pw@localhost:5435/civitas_refund",
    },
    coverage: {
      provider: "v8",
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      exclude: ["dist/**", "src/index.ts", "src/worker.ts", "vitest.config.ts"],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 65,
        statements: 80,
      },
    },
  },
});
