import { describe, it, expect } from "vitest";
import enMessages from "@/messages/en.json";
import hiMessages from "@/messages/hi.json";
import { REIMBURSEMENT_CATEGORIES, reimbursementCategoryKey } from "./reimbursementCategories";

describe("reimbursementCategoryKey (GAP-PAYROLL-REIMBURSEMENTS-04)", () => {
  it("maps every backend code to a key present in en and hi", () => {
    const en = enMessages.createReimbursementForm as Record<string, string>;
    const hi = (hiMessages as unknown as { createReimbursementForm: Record<string, string> }).createReimbursementForm;
    for (const code of REIMBURSEMENT_CATEGORIES) {
      const key = reimbursementCategoryKey(code)!;
      expect(en[key], code).toBeTruthy();
      expect(hi[key], code).toBeTruthy();
    }
    expect(en[reimbursementCategoryKey("lta")!]).toBe("LTA");
  });

  it("returns null for an unknown code", () => {
    expect(reimbursementCategoryKey("crypto")).toBeNull();
  });
});
