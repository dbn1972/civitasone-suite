import { describe, it, expect } from "vitest";
import { mapContracts, contractStatus } from "./outsourcedModel";

const base = { id: "c1", vendorName: "SecureGuard", serviceCategory: "Security", contractRef: null, headcount: 12, contractStart: "2026-01-01", contractEnd: "2026-12-31", contractValueMinor: "123456700", status: "active" };

describe("outsourced contract mapping (GAP-HR-OUTSOURCED-01)", () => {
  it("renders paise as rupees without float math and formats the window", () => {
    const [r] = mapContracts([base], "2026-06-01");
    expect(r!.contractValue).toBe("₹12,34,567.00");
    expect(r!.period).toBe("01 Jan 2026 – 31 Dec 2026");
    expect(r!.contractRef).toBe("—");
    expect(r!.status).toBe("active");
    expect(r!.canTerminate).toBe(true);
  });

  it("derives expired from an active contract past its end date, and keeps terminated final", () => {
    expect(contractStatus("active", "2026-05-31", "2026-06-01")).toBe("expired");
    expect(contractStatus("active", "2026-06-01", "2026-06-01")).toBe("active"); // ends today: still active
    expect(contractStatus("terminated", "2099-01-01", "2026-06-01")).toBe("terminated");
    const [r] = mapContracts([{ ...base, status: "terminated" }], "2026-06-01");
    expect(r!.canTerminate).toBe(false);
  });

  it("keeps a very large paise value exact (beyond 2^53)", () => {
    const [r] = mapContracts([{ ...base, contractValueMinor: "900719925474099300" }], "2026-06-01");
    expect(r!.contractValue).toBe("₹9,00,71,99,25,47,40,993.00");
  });
});
