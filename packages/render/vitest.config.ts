import { defineConfig } from "vitest/config";
import { sharedTestTimeouts } from "../../vitest.shared";

export default defineConfig({
  test: {
    ...sharedTestTimeouts,
    include: ["src/**/*.test.ts"],
  },
});
