import { describe, it, expect } from "vitest";
import { recordOfflineBody } from "./validators.js";

describe("recordOfflineBody offline instrument fields", () => {
  const base = { applicationId: "11111111-1111-4111-8111-111111111111", scheduleId: "22222222-2222-4222-8222-222222222222" };
  it("keeps method/instrumentRef/payerName instead of stripping them", () => {
    const p = recordOfflineBody.parse({ ...base, method: "cheque", instrumentRef: "CHQ-001", payerName: "A B" });
    expect(p).toMatchObject({ method: "cheque", instrumentRef: "CHQ-001", payerName: "A B" });
  });
  it("requires instrumentRef for cheque/dd", () => {
    expect(() => recordOfflineBody.parse({ ...base, method: "dd" })).toThrow();
    expect(recordOfflineBody.parse({ ...base, method: "cash" }).method).toBe("cash");
  });
});
