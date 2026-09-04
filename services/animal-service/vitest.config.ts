import { defineConfig } from "vitest/config";

// building-service had no local vitest config, so it silently inherited the
// repo root's `include: ["tests/**/*.test.ts"]` fallback (vitest.config.mjs)
// — which doesn't match this service's tests, co-located under src/modules/**
// the same way every other properly-configured service in this monorepo does
// (see e.g. services/hrms-service/vitest.config.ts). That's very likely *why*
// this service had zero test coverage: any test file placed the normal way
// would have been silently skipped ("No test files found") rather than run.
// This file intentionally omits `include` so vitest falls back to its own
// built-in default (`**/*.{test,spec}.ts`), which picks up both the
// co-located module tests AND the top-level tests/ directory added in this
// pass (mirroring swm-service/trade-service's DB-backed integration suite
// convention) without needing a second config.
export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      // Same convention as every other DB-backed service's vitest config
      // (e.g. services/swm-service/vitest.config.ts,
      // services/sewerage-service/vitest.config.ts): default to the CI
      // bootstrap's role/db for this service (see
      // infra/db/bootstrap/bootstrap_municipal_services.sql and
      // scripts/ci/bootstrap-postgres.sh's SERVICE_DBS[animal-service]),
      // overridable via a real DATABASE_URL env var for local runs against
      // an isolated container.
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://animal_svc:animal_dev_pw@localhost:5435/civitas_animal",
    },
    coverage: {
      provider: "v8",
      exclude: ["dist/**", "src/index.ts", "src/worker.ts", "**/*.config.ts"],
    },
  },
});
