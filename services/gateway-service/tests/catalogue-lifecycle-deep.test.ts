/**
 * Gateway Service — API Catalogue Lifecycle: Deep tests.
 * Source: modules/catalogue/domain.ts
 */
import { describe, it, expect } from "vitest";
import { applyLifecycle, isTerminalStatus, changeTypeForAction, LifecycleError, type ApiStatus, type ApiAction } from "../src/modules/catalogue/domain.js";

describe("applyLifecycle — API status state machine", () => {
  const valid: [ApiStatus, ApiAction, ApiStatus][] = [
    ["draft", "activate", "active"],
    ["draft", "deprecate", "deprecated"],
    ["active", "deprecate", "deprecated"],
    ["active", "retire", "retired"],
    ["deprecated", "retire", "retired"],
    ["deprecated", "reinstate", "active"],
  ];
  for (const [from, action, to] of valid) {
    it(`${from} + ${action} → ${to}`, () => expect(applyLifecycle(from, action)).toBe(to));
  }

  it("retired is terminal (no action works)", () => {
    for (const action of ["activate", "deprecate", "retire", "reinstate"] as ApiAction[]) {
      expect(() => applyLifecycle("retired", action)).toThrow(LifecycleError);
    }
  });
  it("draft cannot retire directly", () => expect(() => applyLifecycle("draft", "retire")).toThrow(LifecycleError));
  it("active cannot reinstate (already active)", () => expect(() => applyLifecycle("active", "reinstate")).toThrow(LifecycleError));
  it("draft cannot reinstate", () => expect(() => applyLifecycle("draft", "reinstate")).toThrow(LifecycleError));
});

describe("isTerminalStatus", () => {
  it("retired is terminal", () => expect(isTerminalStatus("retired")).toBe(true));
  it("active is NOT terminal", () => expect(isTerminalStatus("active")).toBe(false));
  it("deprecated is NOT terminal", () => expect(isTerminalStatus("deprecated")).toBe(false));
  it("draft is NOT terminal", () => expect(isTerminalStatus("draft")).toBe(false));
});

describe("changeTypeForAction", () => {
  it("activate → activated", () => expect(changeTypeForAction("activate")).toBe("activated"));
  it("deprecate → deprecated", () => expect(changeTypeForAction("deprecate")).toBe("deprecated"));
  it("retire → retired", () => expect(changeTypeForAction("retire")).toBe("retired"));
  it("reinstate → reinstated", () => expect(changeTypeForAction("reinstate")).toBe("reinstated"));
});
