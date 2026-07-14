import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["src/**/*.test.ts"],
    passWithNoTests: false,
    coverage: {
      provider: "v8",
      // Scoped to files touched by the redaction sanitizer work (task 2.1).
      // index.ts/tracing.ts predate this change and are covered by their own
      // consuming services' test suites (see e.g. queue-service,
      // notification-service tests) — they are not part of this task's diff.
      include: ["src/redaction.ts"],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 65,
        statements: 80,
      },
    },
  },
});
