import { defineConfig } from "vitest/config";
export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
  },
});
