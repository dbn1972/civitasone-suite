/** CAP-039 — deviation/waiver lifecycle pure domain: maker-checker + expiry. */
import { describe, it, expect } from "vitest";
import { validateRaise, canReview, canRevoke, isActive, hasLapsed, decisionStatus, type DeviationState } from "../src/modules/deviations/domain.js";

const MAKER = "11111111-0000-4000-8000-000000000001";
const CHECKER = "22222222-0000-4000-8000-000000000002";

function state(p: Partial<DeviationState> = {}): DeviationState {
  return { status: "pending", requestedBy: MAKER, expiresAt: null, ...p };
}

describe("validateRaise", () => {
  it("requires a reason", () => {
    expect(validateRaise("  ").errors).toContain("REASON_REQUIRED");
    expect(validateRaise("valid reason").allowed).toBe(true);
  });
});

describe("canReview — maker-checker", () => {
  it("blocks the requester from reviewing their own deviation", () => {
    const r = canReview(state(), MAKER);
    expect(r.allowed).toBe(false);
    expect(r.errors).toContain("MAKER_CHECKER_VIOLATION");
  });
  it("allows a different reviewer on a pending deviation", () => {
    expect(canReview(state(), CHECKER).allowed).toBe(true);
  });
  it("blocks reviewing a non-pending deviation", () => {
    expect(canReview(state({ status: "approved" }), CHECKER).errors).toContain("NOT_PENDING");
  });
});

describe("canRevoke", () => {
  it("only an approved deviation can be revoked", () => {
    expect(canRevoke(state({ status: "approved" })).allowed).toBe(true);
    expect(canRevoke(state({ status: "pending" })).errors).toContain("NOT_APPROVED");
    expect(canRevoke(state({ status: "revoked" })).errors).toContain("NOT_APPROVED");
  });
});

describe("isActive / hasLapsed", () => {
  const now = new Date("2026-01-01T00:00:00Z");
  it("approved + unexpired is active", () => {
    expect(isActive(state({ status: "approved", expiresAt: "2026-02-01T00:00:00Z" }), now)).toBe(true);
  });
  it("approved + past expiry is inactive and lapsed", () => {
    const s = state({ status: "approved", expiresAt: "2025-12-01T00:00:00Z" });
    expect(isActive(s, now)).toBe(false);
    expect(hasLapsed(s, now)).toBe(true);
  });
  it("pending/rejected/revoked are never active", () => {
    for (const st of ["pending", "rejected", "revoked"] as const) {
      expect(isActive(state({ status: st }), now)).toBe(false);
    }
  });
});

describe("decisionStatus", () => {
  it("maps approve/reject", () => {
    expect(decisionStatus("approve")).toBe("approved");
    expect(decisionStatus("reject")).toBe("rejected");
  });
});
