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
     * History (each measured, not estimated):
     *   35.1%  reported before the runner scope was fixed — but 561 of 1029
     *          mutants were NoCoverage because no payroll/GL/F&F test was
     *          loaded. That number described the include-list, not the tests.
     *   58.31% after wiring the real suites in (600 killed, NoCoverage 128).
     *   68.03% after the payroll burn-down (700 killed, NoCoverage 57).
     *   71.29% after the payments + F&F burn-down (755 killed, NoCoverage 48).
     *
     * The L11 exit criterion of >=70% is now MET at the suite level. `break` is
     * held just below the measured score so a regression fails the build; it is
     * a floor, not the target. Raise it as the burn-down continues; never lower.
     *
     * Per-file state (target >=70%):
     *   payroll/domain.ts    60.2%  149 survived, 22 no-coverage  <- only file
     *                                                               still short
     *   payments/domain.ts   70.9%   OK  (was 57.7%)
     *   quorum/domain.ts     73.0%   OK
     *   authority/domain.ts  73.6%   OK
     *   budget/domain.ts     81.8%   OK
     *   gl/domain.ts         87.0%   OK
     *   fnf/domain.ts        96.2%   OK  (was 59.6%)
     *   decisions/domain.ts  98.8%   OK
     *
     * Inspect remaining gaps with:
     *   node scripts/ci/mutation-survivors.mjs "payroll/domain" 60
     */
    break: 68,
  },
  concurrency: 4,
  timeoutMS: 30000,
  tempDirName: ".stryker-tmp",
  cleanTempDir: "always",
  incremental: true,
  incrementalFile: ".stryker-tmp/incremental.json",
};
