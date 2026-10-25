import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, it, expect } from "vitest";

/**
 * V4-A-07 preventive control: these forms post paise as a JSON number, so the
 * digit string must go through minorToSafeNumber (rejects > MAX_SAFE_INTEGER)
 * and never a bare Number(<paise string>).
 */
const FORMS = [
  "app/(app)/hr/medical/new/NewMedicalClaimForm.tsx",
  "app/(app)/assets/condemnation/CondemnationWorkflow.tsx",
  "app/(app)/assets/[id]/AssetFinancialActions.tsx",
  "app/(app)/assets/insurance/claims/ClaimActions.tsx",
  "app/(app)/contracts/[id]/BondActions.tsx",
  "app/(app)/procurement/contracts/new/CreateContractForm.tsx",
];
const BARE = /\bNumber\(\s*(rupeesToMinorString|amountMinor|newBookValueMinor|check\.minor|minor)\b/;

describe("money forms never Number() a paise string directly", () => {
  for (const rel of FORMS) {
    it(rel, () => {
      const src = readFileSync(resolve(__dirname, "..", rel), "utf8");
      expect(src).toContain("minorToSafeNumber");
      expect(src).not.toMatch(BARE);
    });
  }
});
