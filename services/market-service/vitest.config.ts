import { defineConfig } from "vitest/config";

// Re-review fix (PR #821 REQUEST CHANGES, HIGH finding #2 — zero test
// coverage): market-service had no local vitest config, so it silently
// inherited the repo root's `include: ["tests/**/*.test.ts"]` fallback
// (vitest.config.mjs) — which doesn't match tests co-located under
// src/modules/**, the convention every other properly-configured service in
// this monorepo uses (see e.g. services/animal-service, hrms-service). With
// that inherited config, `pnpm test` reports "No test files found, exiting
// with code 1" regardless of how many *.test.ts files exist under src/ — this
// is very likely *why* this service had zero coverage despite this being its
// first migration and adding non-trivial financial/lifecycle logic: any test
// placed the normal way would have been invisible to the test runner. This
// file intentionally omits `include` so vitest falls back to its own built-in
// default (`**/*.{test,spec}.ts`), which does pick up co-located tests, and
// mirrors the memory-driver env other services use so consumer/route tests
// don't need a real Redis/Postgres connection.
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
