/**
 * Shared vitest defaults for every workspace package's vitest.config.ts.
 *
 * Spread FIRST inside each config's `test: { ... }` block so a package can
 * still deliberately set a LONGER value (queue-service keeps 90s).
 *
 * Why: the CI test-suite triage (2026-10-02, group A) found ~87 of ~100
 * failing files were vitest's 5s default testTimeout / 10s hookTimeout being
 * exceeded under CI contention (turbo running ~10 package suites at once on a
 * 4-vCPU runner against one Postgres), mostly a cold buildApp() or
 * `await import("../src/app.js")` inside the test body. They pass locally;
 * which ones crossed 5s depended on scheduling. These limits still bound a
 * genuinely hung test while removing that scheduling lottery.
 */
export const sharedTestTimeouts = {
  testTimeout: 30_000,
  hookTimeout: 60_000,
} as const;
