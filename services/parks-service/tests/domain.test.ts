import { describe, it, expect } from "vitest";
import { validateComplaintTransition } from "../src/modules/complaints/domain.js";
import { validateInspectionTransition } from "../src/modules/inspections/domain.js";
import { validateTreeRequestTransition } from "../src/modules/tree_requests/domain.js";
import { validateAssetStatusTransition } from "../src/modules/assets/domain.js";

describe("parks-service domain", () => {
  it("allows reported → assigned complaint", () => {
    expect(validateComplaintTransition("reported", "assigned")).toBeNull();
  });
  it("rejects closed → assigned complaint", () => {
    expect(validateComplaintTransition("closed", "assigned")).toMatch(/invalid transition/);
  });
  it("allows scheduled → in_progress inspection", () => {
    expect(validateInspectionTransition("scheduled", "in_progress")).toBeNull();
  });
  it("allows submitted → inspected tree request", () => {
    expect(validateTreeRequestTransition("submitted", "inspected")).toBeNull();
  });
  it("rejects rejected → submitted tree request", () => {
    expect(validateTreeRequestTransition("rejected", "submitted")).toMatch(/invalid transition/);
  });
  it("allows active → under_maintenance asset", () => {
    expect(validateAssetStatusTransition("active", "under_maintenance")).toBeNull();
  });
  it("allows closed → active asset reopen", () => {
    expect(validateAssetStatusTransition("closed", "active")).toBeNull();
  });
});