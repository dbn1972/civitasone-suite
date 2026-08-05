import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    env: {
      // The relay tests use fake db/queue handles and mock @civitasone/observability,
      // so no real queue driver is loaded. QUEUE_DRIVER is set to the safe in-memory
      // value purely to satisfy any incidental env reads on import.
      QUEUE_DRIVER: process.env.QUEUE_DRIVER ?? "memory",
    },
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 80,
        functions: 80,
        branches: 70,
        statements: 80,
      },
    },
  },
});
