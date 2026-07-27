/**
 * Vitest config for mutation testing (Stryker runner).
 *
 * SCOPE MUST MATCH stryker.config.mjs `mutate`. If a file is mutated but no test
 * here exercises it, every one of its mutants reports NoCoverage and the score
 * silently collapses — which is exactly what happened before this revision:
 *
 *   payroll/domain.ts   0 killed / 430 mutants   (no payroll test was loaded)
 *   fnf/domain.ts       0 killed /  52 mutants   (no F&F test was loaded)
 *   gl/domain.ts        0 killed /  23 mutants   (no GL test was loaded)
 *
 * 561 of 1029 mutants were NoCoverage, producing a 35.1% score that described
 * the runner's include-list rather than the test suites. The salary/tax/pension
 * engine and the double-entry invariant — the code where a bug means wrong pay
 * or an unbalanced ledger — had zero mutation coverage.
 *
 * Every file below was verified to PASS IN ISOLATION before being added, because
 * Stryker aborts if its initial dry-run fails. Re-verify before adding more:
 *   npx vitest run <file> --root services/<svc>
 */
import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

export default defineConfig({
  resolve: {
    alias: {
      "@civitasone/auth": resolve(__dirname, "packages/auth/dist/index.js"),
      "@civitasone/queue": resolve(__dirname, "packages/queue/dist/index.js"),
      "@civitasone/cache": resolve(__dirname, "packages/cache/dist/index.js"),
    },
  },
  test: {
    // The payroll tax engine throws UnconfiguredFyError unless slabs are
    // registered first; the per-service config does this via setupFiles, so the
    // mutation runner must too or 31 tests fail on a missing FY config.
    setupFiles: ["services/payroll-service/tests/setup-tax-config.ts"],
    env: {
      JWT_ALGORITHM: "HS256",
      JWT_SECRET: "test_secret_for_civitasone_32chr",
      PII_ENC_KEY: "test_pii_key_for_civitasone_dev_32chars",
      QUEUE_DRIVER: "memory",
      CACHE_DRIVER: "memory",
    },
    include: [
      // ── finance: budget domain + consumer + three-way-match + bank-file ────
      "services/finance-service/tests/budget-domain.test.ts",
      "services/finance-service/tests/budget-consumer.test.ts",
      "services/finance-service/tests/three-way-match.test.ts",
      "services/finance-service/tests/bank-file-generator.test.ts",

      // ── finance: gl/domain.ts (double-entry) — was 0/23 NoCoverage ─────────
      // finance.test.ts also covers GL but imports shared/db.ts, which needs a
      // live DATABASE_URL. Excluded to keep the mutation run hermetic; GL stays
      // covered by auto-journal plus the L10 golden-oracle test below.
      "services/finance-service/tests/auto-journal.test.ts",

      // ── finance: payments/domain.ts — was 32%, add conservation invariants ─
      "services/finance-service/tests/payments-domain.test.ts",
      "services/finance-service/tests/payment-conservation.test.ts",

      // ── payroll: payroll/domain.ts — was 0/430 NoCoverage ──────────────────
      // payroll.test.ts excluded for the same reason (imports shared/db.ts).
      "services/payroll-service/tests/domain.test.ts",
      "services/payroll-service/tests/payroll-domain-coverage.test.ts",
      "services/payroll-service/tests/tax-engine-coverage.test.ts",

      // ── payroll: fnf/domain.ts — was 0/52 NoCoverage ───────────────────────
      "services/payroll-service/tests/fnf-domain.test.ts",

      // ── workflow: authority, quorum, decisions (already had real signal) ───
      "services/workflow-service/tests/authority-domain.test.ts",
      "services/workflow-service/tests/quorum-domain.test.ts",
      "services/workflow-service/tests/decision-domain.test.ts",

      // ── quality program: golden-oracle + canary assertions on the same
      //    domain files. These assert against independently-computed expected
      //    values, so they kill mutants that self-consistent tests miss.
      "tests/quality-program/L10-domain-correctness/payroll-domain.test.ts",
      // Mutation burn-down: targets the ESI cap/rates, PT guard, annualisation,
      // extra-income sign, the previously-uncovered old-regime branch, the
      // zero-component omission guards and the recovery floor.
      "tests/quality-program/L10-domain-correctness/payroll-slip-mutants.test.ts",
      "tests/quality-program/L10-domain-correctness/finance-domain.test.ts",
      "tests/quality-program/L11-mutation-canary/canary-tests.test.ts",
    ],
    testTimeout: 20000,
    coverage: { enabled: false },
  },
});
