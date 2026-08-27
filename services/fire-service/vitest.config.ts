import { defineConfig } from "vitest/config";

// Same root-cause fix as market-service (see that PR): no local vitest config
// meant this service silently inherited the repo root's
// include: ["tests/**/*.test.ts"] fallback, which doesn't match tests
// co-located under src/modules/** the way other properly-configured services
// in this monorepo work. Adding the (currently only) domain-level test for
// this PR's checkNocEligibility fix surfaced the gap.
export default defineConfig({
  test: {
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
  },
});
