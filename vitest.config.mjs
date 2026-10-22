import { fileURLToPath } from "node:url";

export default {
  // Root tests that load apps/web source (e.g. tests/contract/disciplinary-case-actions-parity.contract.test.ts
  // imports the case-page action table, which imports "@/lib/auth/workRoles") need the same "@" -> apps/web/src
  // alias apps/web/vitest.config.ts defines; without it the file cannot even be loaded at the repo root. A string
  // alias matches only "@" and "@/..." specifiers, never a scoped package such as "@civitasone/schemas".
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./apps/web/src", import.meta.url)),
    },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    passWithNoTests: false,
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
      // Finance service DB (for cross-tenant isolation tests)
      DATABASE_URL: process.env.DATABASE_URL ?? "postgres://finance_svc:finance_dev_pw@localhost:5435/civitas_finance",
    },
    coverage: {
      provider: "v8",
      // R20: emit a machine-readable summary so qa-readiness-score can measure
      // REAL coverage (not just test-file presence) when coverage has been run.
      reporter: ["text", "json-summary"],
      reportsDirectory: "coverage",
      thresholds: {
        lines: 70,
        functions: 70,
        branches: 60,
        statements: 70,
      },
    },
  },
};
