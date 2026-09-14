import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://project_svc:project_dev_pw@localhost:5435/civitas_project"
          : (() => {
              throw new Error(
                "REL-035: DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      // Cross-tenant RAG sweep reads through the BYPASSRLS scanner role (migration 0019).
      PROJECT_SCANNER_DATABASE_URL:
        process.env.PROJECT_SCANNER_DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://project_scanner:project_scanner_dev_pw@localhost:5435/civitas_project"
          : (() => {
              throw new Error(
                "REL-035: PROJECT_SCANNER_DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export PROJECT_SCANNER_DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      FINANCE_SERVICE_URL: "http://localhost:3007",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "**/*.config.ts",
        "**/*.config.js",
        "src/**/consumer.ts",
        "src/**/repo.ts",
        "src/**/commands.ts",
        "src/**/queries.ts",
        "src/modules/geo/domain.ts",
        "src/modules/utilisation/domain.ts",
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
