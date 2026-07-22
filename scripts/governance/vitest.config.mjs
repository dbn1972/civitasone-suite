import { defineConfig } from "vitest/config";

// Local Vitest config for the governance module's tests. The repo-root
// vitest.config.mjs restricts `include` to `tests/**/*.test.ts`, which does
// not cover this module's co-located `*.test.ts` files. This config scopes
// discovery to this directory only.
export default defineConfig({
  test: {
    include: ["**/*.test.ts"],
    passWithNoTests: false,
  },
});
