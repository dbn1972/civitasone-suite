import { defineConfig } from "vitest/config";
import { sharedTestTimeouts } from "../../vitest.shared";

// Default `test` is fast. Real-OCR accuracy/e2e tests (tests/cer, need traineddata + fonts) run via `test:cer`.
export default defineConfig({
  test: {
    ...sharedTestTimeouts,
    include: ["src/**/*.test.ts", "tests/**/*.test.ts"],
    exclude: ["**/node_modules/**", "tests/cer/**"],
    passWithNoTests: false,
  },
});
