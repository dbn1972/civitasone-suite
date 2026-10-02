import { defineConfig } from "vitest/config";
import { sharedTestTimeouts } from "../../vitest.shared";

export default defineConfig({
  test: {
    ...sharedTestTimeouts,
    include: ["tests/**/*.test.ts"],
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/index.ts"],
      thresholds: { lines: 80, functions: 80, branches: 75, statements: 80 },
    },
  },
});
