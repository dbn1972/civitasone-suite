import { describe, it, expect } from "vitest";
import { validateAppTransition, validateConnTransition } from "../src/modules/connections/domain.js";
import { validateBookingTransition } from "../src/modules/desludging/domain.js";
import { validateComplaintTransition } from "../src/modules/complaints/domain.js";
import { validateBillTransition } from "../src/modules/billing/domain.js";

describe("sewerage-service domain", () => {
  it("allows submitted → feasibility_check", () => {
    expect(validateAppTransition("submitted", "feasibility_check")).toBeNull();
  });
  it("rejects submitted → activated", () => {
    expect(validateAppTransition("submitted", "activated")).toMatch(/invalid transition/);
  });
  it("allows active → suspended connection", () => {
    expect(validateConnTransition("active", "suspended")).toBeNull();
  });
  it("rejects disconnected → active", () => {
    expect(validateConnTransition("disconnected", "active")).toMatch(/invalid transition/);
  });
  it("allows requested → scheduled booking", () => {
    expect(validateBookingTransition("requested", "scheduled")).toBeNull();
  });
  it("rejects completed → requested booking", () => {
    expect(validateBookingTransition("completed", "requested")).toMatch(/invalid transition/);
  });
  it("allows reported → assigned complaint", () => {
    expect(validateComplaintTransition("reported", "assigned")).toBeNull();
  });
  it("allows generated → sent bill", () => {
    expect(validateBillTransition("generated", "sent")).toBeNull();
  });
  it("rejects paid → sent bill", () => {
    expect(validateBillTransition("paid", "sent")).toMatch(/invalid bill transition/);
  });
});