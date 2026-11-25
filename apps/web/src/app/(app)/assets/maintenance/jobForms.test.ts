import { describe, it, expect } from "vitest";
import { rupeesToPaise, validateComplete, completeBody, validateMeter, meterBody, isOpenJob } from "./jobForms";

describe("maintenance job forms", () => {
  it("converts rupees to paise and rejects bad amounts", () => {
    expect(rupeesToPaise("")).toBe(0);
    expect(rupeesToPaise("1250.5")).toBe(125050);
    expect(rupeesToPaise("12.345")).toBeNull();
    expect(rupeesToPaise("-5")).toBeNull();
    expect(rupeesToPaise("99999999999999999999")).toBeNull();
  });
  it("validates completion date and cost", () => {
    expect(validateComplete({ completedDate: "2026-11-26", cost: "", notes: "" }, "2026-11-25").completedDate).toBe("errDateFuture");
    expect(validateComplete({ completedDate: "", cost: "x", notes: "" }, "2026-11-25")).toEqual({ completedDate: "errCompletedDateRequired", cost: "errCostInvalid" });
    expect(validateComplete({ completedDate: "2026-11-24", cost: "4500", notes: "" }, "2026-11-25")).toEqual({});
  });
  it("builds the service body", () => {
    expect(completeBody({ completedDate: "2026-11-24", cost: "4500.50", notes: " Replaced bearings " })).toEqual({
      completedDate: "2026-11-24", costMinor: 450050, currency: "INR", notes: "Replaced bearings",
    });
  });
  it("validates and builds a meter reading", () => {
    const f = { meterType: "odometer" as const, value: "48210", unit: "km", readingDate: "2026-11-24", notes: "" };
    expect(validateMeter(f, "2026-11-25")).toEqual({});
    expect(validateMeter({ ...f, value: "0" }, "2026-11-25")).toHaveProperty("value");
    expect(meterBody(f)).toEqual({ meterType: "odometer", readingValue: 48210, unit: "km", readingDate: "2026-11-24", source: "manual" });
  });
  it("only scheduled / in_progress / overdue jobs are open", () => {
    expect(["scheduled", "in_progress", "overdue"].every(isOpenJob)).toBe(true);
    expect(isOpenJob("completed") || isOpenJob("cancelled")).toBe(false);
  });
});
