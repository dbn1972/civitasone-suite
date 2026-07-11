/** Pure-domain tests for the appeal state machine + id derivation (§25). */
import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  isTerminal,
  deriveAppealId,
  APPEAL_STATUSES,
} from "../src/modules/appeal/domain.js";

describe("appeal domain — state machine", () => {
  it("a filed appeal can be registered or withdrawn", () => {
    expect(canTransition("filed", "registered")).toBe(true);
    expect(canTransition("filed", "withdrawn")).toBe(true);
  });

  it("a registered appeal can be decided (allowed/dismissed/remanded/modified) or withdrawn", () => {
    expect(canTransition("registered", "allowed")).toBe(true);
    expect(canTransition("registered", "dismissed")).toBe(true);
    expect(canTransition("registered", "remanded")).toBe(true);
    expect(canTransition("registered", "modified")).toBe(true);
    expect(canTransition("registered", "withdrawn")).toBe(true);
  });

  it("rejects representative illegal transitions", () => {
    // Cannot decide a filed (not yet registered) appeal.
    expect(canTransition("filed", "allowed")).toBe(false);
    // Cannot skip back from registered to filed.
    expect(canTransition("registered", "filed")).toBe(false);
    // Cannot register an already-registered appeal.
    expect(canTransition("registered", "registered")).toBe(false);
  });

  it("terminal states cannot transition further", () => {
    for (const t of ["allowed", "dismissed", "remanded", "modified", "withdrawn"] as const) {
      expect(isTerminal(t)).toBe(true);
      expect(canTransition(t, "registered")).toBe(false);
      expect(() => assertTransition(t, "allowed")).toThrow(/INVALID_APPEAL_TRANSITION/);
    }
  });

  it("filed and registered are non-terminal", () => {
    expect(isTerminal("filed")).toBe(false);
    expect(isTerminal("registered")).toBe(false);
  });

  it("assertTransition throws with the INVALID_APPEAL_TRANSITION code on an illegal edge", () => {
    expect(() => assertTransition("filed", "allowed")).toThrow(/INVALID_APPEAL_TRANSITION/);
    expect(() => assertTransition("registered", "registered")).toThrow(/INVALID_APPEAL_TRANSITION/);
  });

  it("exposes every status in the APPEAL_STATUSES tuple", () => {
    expect(APPEAL_STATUSES).toEqual([
      "filed", "registered", "allowed", "dismissed", "remanded", "modified", "withdrawn",
    ]);
  });

  it("deriveAppealId is deterministic per (tenant, case, type, filedDate)", () => {
    const t = "11111111-1111-1111-1111-111111111111";
    const c = "22222222-2222-2222-2222-222222222222";
    expect(deriveAppealId(t, c, "appeal", "2026-07-10")).toBe(deriveAppealId(t, c, "appeal", "2026-07-10"));
    expect(deriveAppealId(t, c, "appeal", "2026-07-10")).not.toBe(deriveAppealId(t, c, "appeal", "2026-07-11"));
    expect(deriveAppealId(t, c, "appeal", "2026-07-10")).not.toBe(deriveAppealId(t, c, "revision", "2026-07-10"));
  });
});
