import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://meeting_svc:meeting_dev_pw@localhost:5435/civitas_meeting"
          : (() => {
              throw new Error(
                "REL-035: DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      DB_URL:
        process.env.DB_URL ??
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://meeting_svc:meeting_dev_pw@localhost:5435/civitas_meeting"
          : (() => {
              throw new Error(
                "REL-035: DB_URL (or DATABASE_URL) is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DB_URL (or DATABASE_URL) explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      MEETING_PII_KEY: "test_pii_master_key_for_vitest_32",
      MEETING_PII_SALT: "civitas-meeting-pii",
      MEETING_CLASSIFIED_KEY: "test_classified_key_for_vitest_32",
      MEETING_QR_SECRET: "test_meeting_qr_secret_for_vitest_32",
      RENDER_PDF_MODE: "html-only",
    },
    coverage: {
      provider: "v8",
      exclude: ["dist/**", "src/index.ts", "src/worker.ts", "**/*.config.ts"],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 65,
        statements: 80,
      },
    },
  },
});
