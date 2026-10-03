import { describe, it, expect } from "vitest";
import { aucCapitalizeErrorMessage } from "./capitalizeFlow";

describe("aucCapitalizeErrorMessage (GAP-ASSETS-PROJECTS-09)", () => {
  it("maps the known codes to plain copy and never echoes a code", () => {
    for (const code of ["MAKER_CHECKER", "AUC_NOT_PENDING", "AUC_NOT_CAPITALIZABLE", "FORBIDDEN"]) {
      const msg = aucCapitalizeErrorMessage(code)!;
      expect(msg).toBeTruthy();
      expect(msg).not.toContain(code);
    }
  });
  it("returns null for unknown, missing or prototype-ish codes so the generic message is used", () => {
    expect(aucCapitalizeErrorMessage("SOMETHING_ELSE")).toBeNull();
    expect(aucCapitalizeErrorMessage(null)).toBeNull();
    expect(aucCapitalizeErrorMessage("constructor")).toBeNull();
  });
});
