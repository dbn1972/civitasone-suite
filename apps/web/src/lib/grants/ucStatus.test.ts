import { describe, it, expect } from "vitest";
import { isUcVerified, ucStatusLabel } from "./ucStatus";

describe("ucStatus (GAP-GRANTS-UTILIZATION-02)", () => {
  it("treats validated and verified as verified", () => {
    expect(isUcVerified("validated")).toBe(true);
    expect(isUcVerified("verified")).toBe(true);
    expect(isUcVerified("submitted")).toBe(false);
    expect(isUcVerified(null)).toBe(false);
  });

  it("labels both spellings 'Verified' (never 'Validated') and leaves others to the default", () => {
    expect(ucStatusLabel("validated")).toBe("Verified");
    expect(ucStatusLabel("verified")).toBe("Verified");
    expect(ucStatusLabel("submitted")).toBeUndefined();
    expect(ucStatusLabel("rejected")).toBeUndefined();
  });
});
