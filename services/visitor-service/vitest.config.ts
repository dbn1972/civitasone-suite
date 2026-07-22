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
      // Cross-tenant maintenance workers read through the BYPASSRLS scanner role
      // (migration 0009). Integration tests exercise the real cross-tenant scan.
      VISITOR_SCANNER_DATABASE_URL:
        process.env.VISITOR_SCANNER_DATABASE_URL ??
        "postgres://visitor_scanner:visitor_scanner_dev_pw@localhost:5435/civitas_visitor",
      // At-rest PII encryption key — required for encryptedText() inserts/reads
      // in integration tests that touch visit_requests / blacklist rows.
      VISITOR_PII_KEY:
        process.env.VISITOR_PII_KEY ?? "dev_visitor_pii_master_key_32chars",
    },
    coverage: {
      provider: "v8",
      exclude: [
        "dist/**",
        "src/index.ts",
        "src/worker.ts",
        "**/*.config.ts",
      ],
      thresholds: {
        lines: 80,
        functions: 75,
        branches: 65,
        statements: 80,
      },
    },
  },
});
