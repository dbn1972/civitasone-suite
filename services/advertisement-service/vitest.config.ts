import { defineConfig } from "vitest/config";

// building-service had no local vitest config, so it silently inherited the
// repo root's `include: ["tests/**/*.test.ts"]` fallback (vitest.config.mjs)
// — which doesn't match this service's tests, co-located under src/modules/**
// the same way every other properly-configured service in this monorepo does
// (see e.g. services/hrms-service/vitest.config.ts). That's very likely *why*
// this service had zero test coverage: any test file placed the normal way
// would have been silently skipped ("No test files found") rather than run.
// This file intentionally omits `include` so vitest falls back to its own
// built-in default (`**/*.{test,spec}.ts`), which does pick up co-located
// tests.
//
// DATABASE_URL added (previously absent — this service's 4 consumer.test.ts
// files were mock-only, hence no real Postgres connection was ever needed):
// CI now applies this service's migrations against a real Postgres before
// the Tests job runs (scripts/ci/bootstrap-postgres.sh's SERVICE_DBS map,
// PR #1000), provisioning role advertisement_svc / db civitas_advertisement
// on port 5435 (bootstrap_municipal_services.sql). Mirrors
// services/shop-service/vitest.config.ts's DATABASE_URL convention exactly
// so the now-real, DB-backed consumer tests connect the same way in CI and
// locally (`process.env.DATABASE_URL` still wins when set, e.g. against an
// isolated throwaway container during manual verification).
export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://advertisement_svc:advertisement_dev_pw@localhost:5435/civitas_advertisement",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    coverage: {
      provider: "v8",
      exclude: ["dist/**", "src/index.ts", "src/worker.ts"],
    },
  },
});
