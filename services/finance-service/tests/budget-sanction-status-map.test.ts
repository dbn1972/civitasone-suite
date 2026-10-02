import { describe, it, expect } from "vitest";
import { mapSanctionStatus, isKnownSanctionStatus } from "../src/modules/budget/domain.js";

// Every status finance-service can store on a sanction: schema default "draft",
// SanctionStatus (draft|approved|exhausted|cancelled), the reject consumer
// writes "cancelled", and "pending"/"rejected" from the submit/legacy paths.
describe("mapSanctionStatus", () => {
  it.each([
    ["approved", "approved"],
    ["exhausted", "approved"],
    ["rejected", "rejected"],
    ["cancelled", "rejected"], // sanctionReject consumer stores this
    ["draft", "pending"],
    ["pending", "pending"],
    ["pending_approval", "pending"], // what sanctionCreate / submit-approval store
  ])("%s -> %s", (stored, web) => {
    expect(mapSanctionStatus(stored)).toBe(web);
    expect(isKnownSanctionStatus(stored)).toBe(true);
  });

  it("an unknown status is pending (never approved) and flagged unknown for logging", () => {
    expect(mapSanctionStatus("weird")).toBe("pending");
    expect(isKnownSanctionStatus("weird")).toBe(false);
    expect(isKnownSanctionStatus("toString")).toBe(false);
    expect(mapSanctionStatus("toString")).toBe("pending");
  });
});
