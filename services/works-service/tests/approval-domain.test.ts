/**
 * Approval domain tests — Original/Revised assignment, finalization rules,
 * DAO gate (BR-011), TS prerequisites.
 */
import { describe, it, expect } from "vitest";
import {
  resolveApprovalType,
  canFinalize,
  isDaoFinalizationRequired,
  canEnterTS,
} from "../src/modules/approval/domain.js";

describe("resolveApprovalType", () => {
  it("BR-009: first AA is Original", () => {
    expect(resolveApprovalType(0)).toBe("original");
  });

  it("BR-009: subsequent AAs are Revised", () => {
    expect(resolveApprovalType(1)).toBe("revised");
    expect(resolveApprovalType(5)).toBe("revised");
  });

  it("BR-012: first TS is Original", () => {
    expect(resolveApprovalType(0)).toBe("original");
  });

  it("BR-012: subsequent TS are Revised", () => {
    expect(resolveApprovalType(2)).toBe("revised");
    expect(resolveApprovalType(10)).toBe("revised");
  });
});

describe("canFinalize", () => {
  it("allows finalization of draft approval", () => {
    const result = canFinalize({ id: "a1", status: "draft" });
    expect(result.allowed).toBe(true);
  });

  it("blocks finalization of already-finalized approval", () => {
    const result = canFinalize({ id: "a1", status: "finalized" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("finalized");
  });

  it("blocks finalization of any non-draft status", () => {
    const result = canFinalize({ id: "a1", status: "cancelled" });
    expect(result.allowed).toBe(false);
    expect(result.reason).toContain("cancelled");
  });
});

describe("isDaoFinalizationRequired", () => {
  it("returns true when work is still in draft", () => {
    expect(isDaoFinalizationRequired("draft")).toBe(true);
  });

  it("returns false when work is already dao_finalized", () => {
    expect(isDaoFinalizationRequired("dao_finalized")).toBe(false);
  });

  it("returns false when work is ts_eligible", () => {
    expect(isDaoFinalizationRequired("ts_eligible")).toBe(false);
  });
});

describe("canEnterTS (BR-011)", () => {
  it("blocks TS entry when proposal is still in draft", () => {
    const result = canEnterTS("draft");
    expect(result.allowed).toBe(false);
    expect(result.blockingReason).toContain("DAO finalization");
    expect(result.blockingReason).toContain("BR-011");
  });

  it("allows TS entry when proposal is dao_finalized", () => {
    const result = canEnterTS("dao_finalized");
    expect(result.allowed).toBe(true);
    expect(result.blockingReason).toBeUndefined();
  });

  it("allows TS entry when proposal is ts_eligible", () => {
    const result = canEnterTS("ts_eligible");
    expect(result.allowed).toBe(true);
  });

  it("allows TS entry for any other status (permissive)", () => {
    const result = canEnterTS("in_progress");
    expect(result.allowed).toBe(true);
  });
});
