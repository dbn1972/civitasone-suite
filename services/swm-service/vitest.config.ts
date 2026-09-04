import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: ["tests/**/*.test.ts"],
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://swm_svc:swm_dev_pw@localhost:5435/civitas_swm",
    },
    coverage: {
      provider: "v8",
      exclude: ["dist/**", "src/index.ts", "src/worker.ts", "**/*.config.ts"],
    },
  },
});
