import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // REL-024: buildApp() registers 14+ modules (capa, enforcement, licence,
    // survey, telemetry, findings, universe, risk, planning, assignment,
    // checklist, sync, evidence, execution) and legitimately takes >10s when
    // the CI test job runs all ~115 packages concurrently via
    // turbo test --continue against one shared Postgres container (verified:
    // every file here passes 100% in isolation -- 66/66 files, 1288/1288
    // tests -- so this is CI-load contention hitting vitest's 10s default
    // hookTimeout, not a code bug). universe-routes.test.ts,
    // routes-integration.test.ts, assignment-routes-integration.test.ts and
    // findings-routes-integration.test.ts were the observed victims
    // ("Hook timed out in 10000ms" in beforeAll's buildApp() call),
    // reproduced identically across two separate CI runs. Raised for the
    // whole file since any beforeAll here can be scheduled at the same
    // contention point.
    hookTimeout: 30_000,
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
