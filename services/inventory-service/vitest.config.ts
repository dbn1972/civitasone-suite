import { defineConfig } from "vitest/config";

// CI bootstrap sets civitas_admin from PGPASSWORD/POSTGRES_ADMIN_PASSWORD
// (civitas_test). Turbo 2 strict mode strips undeclared env — see turbo.json
// test.passThroughEnv. Fall back to civitas_test when CI=true.
const adminPw =
  process.env.POSTGRES_ADMIN_PASSWORD ??
  process.env.PGPASSWORD ??
  (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
    ? "civitas_test"
    : "civitas_dev_pw");

export default defineConfig({
  test: {
    // buildApp() + inject under parallel CI load regularly exceeds the 5s default.
    testTimeout: 30_000,
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://inventory_svc:inventory_dev_pw@localhost:5435/civitas_inventory"
          : (() => {
              throw new Error(
                "REL-035: DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      // Surface CI admin password into the vitest worker (DQ suite uses civitas_admin).
      POSTGRES_ADMIN_PASSWORD: adminPw,
      PGPASSWORD: adminPw,
      PGHOST: process.env.PGHOST ?? "localhost",
      PGPORT: process.env.PGPORT ?? "5435",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "src/modules/items/consumer.ts",
        "src/modules/stores/consumer.ts",
        "src/modules/movements/consumer.ts",
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
