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
    /**
     * ENFORCING RATCHET — was `null`, meaning this gate could never fail.
     *
     * Measured 2026-07-27 after fixing the runner scope: 58.31% overall
     * (600 killed / 1029). Before the fix it read 35.1%, but 561 of 1029 mutants
     * were NoCoverage because no payroll/GL/F&F test was loaded — that number
     * described the include-list, not the tests.
     *
     * `break` is set just below the measured score so the gate is REAL (a
     * regression fails the build) without being permanently red. It does NOT
     * assert the L11 exit criterion is met: that requires >=70%, and payroll is
     * at 37.4%. Raise this as the burn-down below lands; do not lower it.
     *
     * Per-file state (target >=70%):
     *   payroll/domain.ts    37.4%  176 survived, 93 no-coverage   <- worst
     *   payments/domain.ts   57.7%   29 survived, 18 no-coverage
     *   fnf/domain.ts        59.6%   19 survived,  2 no-coverage
     *   quorum/domain.ts     73.0%   OK
     *   authority/domain.ts  73.6%   OK
     *   budget/domain.ts     81.8%   OK
     *   gl/domain.ts         87.0%   OK
     *   decisions/domain.ts  98.8%   OK
     */
    break: 55,
  },
  concurrency: 4,
  timeoutMS: 30000,
  tempDirName: ".stryker-tmp",
  cleanTempDir: "always",
  incremental: true,
  incrementalFile: ".stryker-tmp/incremental.json",
};
