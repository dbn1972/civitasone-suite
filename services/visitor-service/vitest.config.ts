import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    // Property-based tests (fast-check) live in tests/properties/*.prop.ts
    // per the design doc's test organization; unit/integration tests use
    // the standard *.test.ts suffix. Both patterns are discovered here.
    include: ["tests/**/*.test.ts", "tests/**/*.prop.ts"],
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      DATABASE_URL:
        process.env.DATABASE_URL ??
        "postgres://visitor_svc:visitor_dev_pw@localhost:5435/civitas_visitor",
    },
    coverage: {
      provider: "v8",
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 65,
        statements: 80,
      },
    },
  },
});
