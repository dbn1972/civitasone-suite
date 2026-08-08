/**
 * CRM Onboarding — state machine and KYC gate domain tests.
 * Pack #15. Source: modules/onboarding/domain.ts
 */
import { describe, it, expect } from "vitest";
import {
  canTransition, isTerminalStage, allowedNextStages, canKycTransition,
  requiresKycVerification, isKycSatisfied, isKycGateSatisfied,
  requiresCancellationReason, isValidCancellationReason,
  INITIAL_STAGE, INITIAL_KYC_STATUS, CANCELLATION_REASON_MIN_LENGTH,
} from "../src/modules/onboarding/domain.js";

describe("onboarding stage transitions", () => {
  it("initiated → documents_submitted", () => expect(canTransition("initiated", "documents_submitted")).toBe(true));
  it("documents_submitted → verification", () => expect(canTransition("documents_submitted", "verification")).toBe(true));
  it("verification → provisioning", () => expect(canTransition("verification", "provisioning")).toBe(true));
  it("provisioning → completed", () => expect(canTransition("provisioning", "completed")).toBe(true));
  it("any live stage → cancelled", () => {
    expect(canTransition("initiated", "cancelled")).toBe(true);
    expect(canTransition("documents_submitted", "cancelled")).toBe(true);
    expect(canTransition("verification", "cancelled")).toBe(true);
    expect(canTransition("provisioning", "cancelled")).toBe(true);
  });
  it("completed is terminal", () => expect(isTerminalStage("completed")).toBe(true));
  it("cancelled is terminal", () => expect(isTerminalStage("cancelled")).toBe(true));
  it("cannot skip stages (initiated → completed)", () => expect(canTransition("initiated", "completed")).toBe(false));
  it("INITIAL_STAGE is initiated", () => expect(INITIAL_STAGE).toBe("initiated"));
});

describe("KYC status transitions", () => {
  it("pending → submitted", () => expect(canKycTransition("pending", "submitted")).toBe(true));
  it("submitted → verified/rejected", () => {
    expect(canKycTransition("submitted", "verified")).toBe(true);
    expect(canKycTransition("submitted", "rejected")).toBe(true);
  });
  it("rejected → submitted (re-file)", () => expect(canKycTransition("rejected", "submitted")).toBe(true));
  it("verified is terminal", () => expect(canKycTransition("verified", "submitted")).toBe(false));
  it("INITIAL_KYC_STATUS is pending", () => expect(INITIAL_KYC_STATUS).toBe("pending"));
});

describe("KYC gate — completion requires verification", () => {
  it("completed requires KYC verification", () => expect(requiresKycVerification("completed")).toBe(true));
  it("other stages do NOT require KYC", () => {
    expect(requiresKycVerification("provisioning")).toBe(false);
    expect(requiresKycVerification("verification")).toBe(false);
  });
  it("isKycSatisfied: only verified passes", () => {
    expect(isKycSatisfied("verified")).toBe(true);
    expect(isKycSatisfied("pending")).toBe(false);
    expect(isKycSatisfied("submitted")).toBe(false);
    expect(isKycSatisfied("rejected")).toBe(false);
  });
  it("gate blocks completion with unverified KYC", () => {
    expect(isKycGateSatisfied("completed", "pending")).toBe(false);
    expect(isKycGateSatisfied("completed", "submitted")).toBe(false);
    expect(isKycGateSatisfied("completed", "rejected")).toBe(false);
  });
  it("gate allows completion with verified KYC", () => {
    expect(isKycGateSatisfied("completed", "verified")).toBe(true);
  });
  it("gate does not block non-completion stages", () => {
    expect(isKycGateSatisfied("provisioning", "pending")).toBe(true);
  });
});

describe("cancellation reason", () => {
  it("cancelled requires a reason", () => expect(requiresCancellationReason("cancelled")).toBe(true));
  it("other stages do not require", () => expect(requiresCancellationReason("completed")).toBe(false));
  it("valid reason ≥ 10 chars", () => expect(isValidCancellationReason("Customer withdrew from the process")).toBe(true));
  it("invalid: too short", () => expect(isValidCancellationReason("short")).toBe(false));
  it("invalid: null", () => expect(isValidCancellationReason(null)).toBe(false));
  it("min length is 10", () => expect(CANCELLATION_REASON_MIN_LENGTH).toBe(10));
});
