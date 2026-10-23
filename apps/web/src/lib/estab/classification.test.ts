import { describe, it, expect } from "vitest";
import { isMaskedClassification, MASKED_CLASSIFICATIONS } from "./classification";

describe("isMaskedClassification (GAP-ESTAB-LIST-01 / GAP-ESTAB-APPROVALS-03)", () => {
  it("masks secret and top_secret, the same set the File Register masks", () => {
    expect([...MASKED_CLASSIFICATIONS].sort()).toEqual(["secret", "top_secret"]);
    expect(isMaskedClassification("secret")).toBe(true);
    expect(isMaskedClassification("top_secret")).toBe(true);
  });

  it("shows public and confidential files", () => {
    expect(isMaskedClassification("public")).toBe(false);
    expect(isMaskedClassification("confidential")).toBe(false);
  });

  it("fails closed when the classification is missing or not text", () => {
    expect(isMaskedClassification(undefined)).toBe(true);
    expect(isMaskedClassification(null)).toBe(true);
    expect(isMaskedClassification(3)).toBe(true);
  });
});
