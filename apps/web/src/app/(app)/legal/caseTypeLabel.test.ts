import { describe, it, expect } from "vitest";
import { caseTypeLabel } from "./caseTypeLabel";

describe("caseTypeLabel", () => {
  it("maps the raw code to a human label", () => {
    expect(caseTypeLabel("writ")).toBe("Writ Petition");
    expect(caseTypeLabel("CIVIL")).toBe("Civil");
  });
  it("humanizes unknown codes rather than showing them raw", () => {
    expect(caseTypeLabel("service_matter")).not.toBe("service_matter");
  });
});
