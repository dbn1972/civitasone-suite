/**
 * CAP-052 — API lifecycle state-machine unit tests (no DB).
 */
import { describe, it, expect } from "vitest";
import {
  applyLifecycle,
  changeTypeForAction,
  isTerminalStatus,
  LifecycleError,
  type ApiStatus,
} from "../src/modules/catalogue/domain.js";

describe("catalogue lifecycle state machine", () => {
  it("allows draft → active (activate) and draft → deprecated (deprecate)", () => {
    expect(applyLifecycle("draft", "activate")).toBe("active");
    expect(applyLifecycle("draft", "deprecate")).toBe("deprecated");
  });

  it("allows active → deprecated and active → retired", () => {
    expect(applyLifecycle("active", "deprecate")).toBe("deprecated");
    expect(applyLifecycle("active", "retire")).toBe("retired");
  });

  it("allows deprecated → retired and deprecated → active (reinstate)", () => {
    expect(applyLifecycle("deprecated", "retire")).toBe("retired");
    expect(applyLifecycle("deprecated", "reinstate")).toBe("active");
  });

  it("treats retired as terminal", () => {
    expect(isTerminalStatus("retired")).toBe(true);
    expect(isTerminalStatus("active")).toBe(false);
    for (const action of ["activate", "deprecate", "retire", "reinstate"] as const) {
      expect(() => applyLifecycle("retired", action)).toThrow(LifecycleError);
    }
  });

  it("rejects illegal transitions with INVALID_TRANSITION", () => {
    try {
      applyLifecycle("draft", "retire");
      throw new Error("should have thrown");
    } catch (err) {
      expect(err).toBeInstanceOf(LifecycleError);
      expect((err as LifecycleError).code).toBe("INVALID_TRANSITION");
    }
    // cannot reinstate something that is already active
    expect(() => applyLifecycle("active", "reinstate")).toThrow(LifecycleError);
  });

  it("maps each action to its changelog change_type", () => {
    expect(changeTypeForAction("activate")).toBe("activated");
    expect(changeTypeForAction("deprecate")).toBe("deprecated");
    expect(changeTypeForAction("retire")).toBe("retired");
    expect(changeTypeForAction("reinstate")).toBe("reinstated");
  });

  it("covers every declared status as a starting state", () => {
    const statuses: ApiStatus[] = ["draft", "active", "deprecated", "retired"];
    // Every status must be recognised by isTerminalStatus without throwing.
    for (const s of statuses) expect(typeof isTerminalStatus(s)).toBe("boolean");
  });
});
