import { describe, it, expect } from "vitest";
import { epaymentStatusVariant } from "./epaymentUi";

describe("epaymentStatusVariant (GAP-FINANCE-TREASURY-E-PAYMENTS-05)", () => {
  it("Released is good, Queued is neutral, the rest defer to the shared StatusPill map", () => {
    expect(epaymentStatusVariant("Released")).toBe("good");
    expect(epaymentStatusVariant("completed")).toBe("good");
    expect(epaymentStatusVariant("Queued")).toBe("mut");
    expect(epaymentStatusVariant("Pending Approval")).toBeUndefined();
    expect(epaymentStatusVariant("Failed")).toBeUndefined();
  });
});
