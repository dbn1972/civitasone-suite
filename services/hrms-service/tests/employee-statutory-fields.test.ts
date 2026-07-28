/**
 * DIC statutory + engagement-type-specific employee identifiers — validator coverage.
 */
import { describe, it, expect } from "vitest";
import { updateEmployeeBody } from "../src/modules/employee/validators.js";

describe("employee statutory / type-specific identifier fields", () => {
  it("accepts ESIC IP, PRAN, GSTIN, SAC, agency ref and NAPS id", () => {
    const r = updateEmployeeBody.parse({
      esicIpNumber: "3100000000",
      pran: "110012345678",
      gstin: "29ABCDE1234F1Z5",
      sacCode: "998311",
      agencyRef: "AG/DEP/2025/017",
      napsId: "NAPS-2025-0001",
    });
    expect(r.pran).toBe("110012345678");
    expect(r.gstin).toBe("29ABCDE1234F1Z5");
    expect(r.esicIpNumber).toBe("3100000000");
    expect(r.napsId).toBe("NAPS-2025-0001");
  });

  it("leaves the identifiers undefined when omitted (all optional)", () => {
    const r = updateEmployeeBody.parse({ mobile: "9876543210" });
    expect(r.pran).toBeUndefined();
    expect(r.gstin).toBeUndefined();
  });

  it("rejects an over-length GSTIN / PRAN", () => {
    expect(() => updateEmployeeBody.parse({ gstin: "X".repeat(20) })).toThrow();
    expect(() => updateEmployeeBody.parse({ pran: "1".repeat(20) })).toThrow();
  });
});
