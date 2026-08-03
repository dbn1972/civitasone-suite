import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://inspection_svc:inspection_dev_pw@localhost:5435/civitas_inspection",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      S3_BUCKET_NAME: "civitas-inspection-test",
      S3_ENDPOINT: "http://localhost:4566",
      S3_REGION: "ap-south-1",
      HRMS_SERVICE_URL: "http://localhost:3012",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "**/*.config.ts",
        "src/modules/*/schema.ts",
        "src/modules/*/repo.ts",
        "src/modules/*/queries.ts",
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
