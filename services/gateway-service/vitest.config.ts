import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    env: {
      NODE_ENV: "test",
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.GATEWAY_DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://gateway_svc:gateway_dev_pw@localhost:5435/civitas_gateway"
          : (() => {
              throw new Error(
                "REL-035: GATEWAY_DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export GATEWAY_DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      INTERNAL_SERVICE_SECRET: "test_internal_secret",
    },
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts", "**/*.d.ts"],
      thresholds: {
        lines: 80,
        statements: 80,
        functions: 75,
        branches: 65,
      },
    },
  },
});
