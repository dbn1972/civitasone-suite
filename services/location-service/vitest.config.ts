import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://location_svc:location_dev_pw@localhost:5435/civitas_location",
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
