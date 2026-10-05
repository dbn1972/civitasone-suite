import { defineConfig } from "vitest/config";
import { sharedTestTimeouts } from "../../vitest.shared";

export default defineConfig({
  test: {
    ...sharedTestTimeouts,
    include: ["tests/cer/**/*.test.ts"],
    testTimeout: 300_000,
    passWithNoTests: false,
  },
});
