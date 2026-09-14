import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globalSetup: ["./tests/setup.ts"],
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        (process.env.CI === "true" || process.env.GITHUB_ACTIONS === "true"
          ? "postgres://location_svc:location_dev_pw@localhost:5435/civitas_location"
          : (() => {
              throw new Error(
                "REL-035: DATABASE_URL is not set. This test suite no longer silently falls back to the shared, long-lived civitasone-postgres:5435 dev instance outside CI — export DATABASE_URL explicitly (point it at your own disposable Postgres) before running tests.",
              );
            })()),
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "src/modules/locations/consumer.ts",
        "src/modules/geofence/consumer.ts",
        "src/modules/hierarchy/consumer.ts",
        "src/modules/jurisdiction/consumer.ts",
        "src/modules/pincode/consumer.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 70,
        branches: 65,
        statements: 80,
      },
    },
  },
});
