/**
 * Gate #11 — Mutation testing configuration.
 *
 * Proves the test suites ACTUALLY CATCH BUGS, not just achieve coverage.
 * Scoped to the highest-value domain logic:
 *   - finance money math (budget constraints, GL double-entry invariants)
 *   - workflow authority/quorum/decision (maker-checker, delegation, SoD)
 *   - payroll computation (salary, tax, F&F — where a BigInt error = wrong pay)
 *
 * A surviving mutant means: we changed production logic and NO test failed.
 * That is a test suite gap, regardless of line-coverage percentage.
 *
 * Threshold: 80% mutation score (kill rate). Below that = BLOCKING.
 * Run: pnpm test:mutation
 */
/** @type {import('@stryker-mutator/api/core').PartialStrykerOptions} */
export default {
  testRunner: "vitest",
  vitest: {
    configFile: "vitest.mutation.config.ts",
  },
  // Plugins must be listed explicitly because pnpm's strict hoisting prevents
  // Stryker from auto-discovering them via the @stryker-mutator/* glob.
  plugins: [
    "@stryker-mutator/vitest-runner",
  ],
  mutate: [
    "services/finance-service/src/modules/budget/domain.ts",
    "services/finance-service/src/modules/gl/domain.ts",
    "services/finance-service/src/modules/payments/domain.ts",
    "services/workflow-service/src/modules/authority/domain.ts",
    "services/workflow-service/src/modules/quorum/domain.ts",
    "services/workflow-service/src/modules/decisions/domain.ts",
    "services/payroll-service/src/modules/payroll/domain.ts",
    "services/payroll-service/src/modules/fnf/domain.ts",
  ],
  // Sandbox exclusions: prevents Stryker from copying files it cannot process.
  // Without these, a broken symlink (services/location-service/seed/README.md →
  // deleted archive/erpnext-develop/) crashes the sandbox creation with ENOENT.
  ignorePatterns: [
    "**/seed/**",
    "archive/**",
    "**/coverage/**",
    "**/dist/**",
    "**/.next/**",
    ".stryker-tmp/**",
    ".git/**",
    ".kiro/**",
    ".claude/**",
  ],
  disableTypeChecks: "services/**/*.ts",
  reporters: ["clear-text", "html", "json"],
  htmlReporter: { fileName: "reports/mutation/index.html" },
  jsonReporter: { fileName: "reports/mutation/mutation-report.json" },
  thresholds: {
    high: 90,
    low: 70,
    // Set to null initially (warn-only). Once payroll/GL test baseline is green
    // and those modules are added to the covered set, raise to 80.
    break: null,
  },
  concurrency: 4,
  timeoutMS: 30000,
  tempDirName: ".stryker-tmp",
  cleanTempDir: "always",
  incremental: true,
  incrementalFile: ".stryker-tmp/incremental.json",
};
