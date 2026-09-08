import { defineConfig } from "vitest/config";

// Local Vitest config for scripts/*.test.ts (co-located tests for standalone
// CLI scripts, e.g. production-readiness-score.test.ts). The repo-root
// vitest.config.mjs restricts `include` to `tests/**/*.test.ts`, which does
// not cover this. Non-recursive on purpose — scripts/governance/ already has
// its own scoped config (scripts/governance/vitest.config.mjs) for its own
// co-located tests; this one only picks up direct children of scripts/.
export default defineConfig({
  test: {
    include: ["*.test.ts"],
    passWithNoTests: false,
  },
});
