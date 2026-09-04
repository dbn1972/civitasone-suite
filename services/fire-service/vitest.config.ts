import { defineConfig } from "vitest/config";

// Same root-cause fix as market-service (see that PR): no local vitest config
// meant this service silently inherited the repo root's
// include: ["tests/**/*.test.ts"] fallback, which doesn't match tests
// co-located under src/modules/** the way other properly-configured services
// in this monorepo work. This file intentionally omits `include` so vitest
// falls back to its own built-in default (`**/*.{test,spec}.ts`), which
// picks up both the co-located `src/modules/nocs/domain.test.ts` AND the new
// top-level `tests/` DB-backed integration suite added in this pass
// (mirroring animal-service's/swm-service's convention) without needing a
// second config.
export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      // Same convention as every other DB-backed service's vitest config
      // (e.g. services/animal-service/vitest.config.ts,
      // services/swm-service/vitest.config.ts): default to the CI
      // bootstrap's role/db for this service (see
      // scripts/ci/bootstrap-postgres.sh's SERVICE_DBS[fire-service]),
      // overridable via a real DATABASE_URL env var for local runs against
      // an isolated container.
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://fire_svc:fire_dev_pw@localhost:5435/civitas_fire",
    },
    coverage: {
      provider: "v8",
      exclude: ["dist/**", "src/index.ts", "src/worker.ts", "**/*.config.ts"],
    },
  },
});
