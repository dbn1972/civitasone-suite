/**
 * Vitest config for mutation testing (Stryker runner).
 *
 * Only includes test files that PASS in isolation AND cover the mutated domain
 * modules. Files with pre-existing failures cause Stryker to abort (its initial
 * dry-run must pass), so this list is curated to the green subset.
 */
import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    include: [
      // Finance — budget domain + consumer + three-way-match + bank-file
      "services/finance-service/tests/budget-domain.test.ts",
      "services/finance-service/tests/budget-consumer.test.ts",
      "services/finance-service/tests/three-way-match.test.ts",
      "services/finance-service/tests/bank-file-generator.test.ts",

      // Workflow — authority, quorum, decisions
      "services/workflow-service/tests/authority-domain.test.ts",
      "services/workflow-service/tests/quorum-domain.test.ts",
      "services/workflow-service/tests/decision-domain.test.ts",
    ],
    testTimeout: 20000,
    coverage: { enabled: false },
  },
});
