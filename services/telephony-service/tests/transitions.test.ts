/**
 * Call state-machine unit tests (pure, no I/O).
 * Proves illegal lifecycle moves are rejected and terminal states are sealed.
 */
import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  isTerminal,
  IllegalTransitionError,
  INITIAL_STATUS,
  TERMINAL_STATUSES,
  type CallStatus,
} from "../src/modules/calls/transitions.js";

describe("call transitions — legal moves", () => {
  it("allows the inbound happy path queued → ringing → answered → completed", () => {
    expect(canTransition("queued", "ringing")).toBe(true);
    expect(canTransition("ringing", "answered")).toBe(true);
    expect(canTransition("answered", "completed")).toBe(true);
  });

  it("allows missed/abandoned exits while ringing, and abandon while queued", () => {
    expect(canTransition("ringing", "missed")).toBe(true);
    expect(canTransition("ringing", "abandoned")).toBe(true);
    expect(canTransition("queued", "abandoned")).toBe(true);
  });
});

describe("call transitions — illegal moves are rejected", () => {
  it("cannot answer a call that never rang", () => {
    expect(canTransition("queued", "answered")).toBe(false);
    expect(() => assertTransition("queued", "answered")).toThrow(IllegalTransitionError);
  });

  it("cannot complete a call that was missed or abandoned", () => {
    expect(canTransition("missed", "completed")).toBe(false);
    expect(canTransition("abandoned", "completed")).toBe(false);
  });

  it("cannot leave a terminal state", () => {
    for (const t of TERMINAL_STATUSES) {
      for (const to of ["queued", "ringing", "answered", "completed"] as CallStatus[]) {
        expect(canTransition(t, to)).toBe(false);
      }
    }
  });

  it("the IllegalTransitionError carries the from/to + code", () => {
    try {
      assertTransition("completed", "answered");
      throw new Error("expected throw");
    } catch (err) {
      expect(err).toBeInstanceOf(IllegalTransitionError);
      const e = err as IllegalTransitionError;
      expect(e.code).toBe("ILLEGAL_TRANSITION");
      expect(e.from).toBe("completed");
      expect(e.to).toBe("answered");
    }
  });
});

describe("initial states + terminality", () => {
  it("inbound starts queued, outbound starts ringing", () => {
    expect(INITIAL_STATUS.inbound).toBe("queued");
    expect(INITIAL_STATUS.outbound).toBe("ringing");
  });

  it("classifies terminal states", () => {
    expect(isTerminal("completed")).toBe(true);
    expect(isTerminal("missed")).toBe(true);
    expect(isTerminal("abandoned")).toBe(true);
    expect(isTerminal("queued")).toBe(false);
    expect(isTerminal("ringing")).toBe(false);
    expect(isTerminal("answered")).toBe(false);
  });
});
