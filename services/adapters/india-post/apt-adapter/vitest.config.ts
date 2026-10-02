import { defineConfig } from "vitest/config";
import { sharedTestTimeouts } from "../../../../vitest.shared";
export default defineConfig({
  test: {
    ...sharedTestTimeouts,
    include: ["tests/**/*.test.ts"],
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
  },
});
