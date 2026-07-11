/** Pure-domain tests for the order-issuance state machine + maker-checker guard. */
import { describe, it, expect } from "vitest";
import {
  canTransition,
  assertTransition,
  isTerminal,
  assertDifferentApprover,
} from "../src/modules/order-issuance/domain.js";

describe("order-issuance domain — state machine", () => {
  it("a draft can be submitted for approval", () => {
    expect(canTransition("draft", "pending_approval")).toBe(true);
  });

  it("a pending order can be issued or sent back to draft", () => {
    expect(canTransition("pending_approval", "issued")).toBe(true);
    expect(canTransition("pending_approval", "draft")).toBe(true);
  });

  it("an issued order can only be recalled", () => {
    expect(canTransition("issued", "recalled")).toBe(true);
    expect(canTransition("issued", "draft")).toBe(false);
    expect(canTransition("issued", "pending_approval")).toBe(false);
  });

  it("rejects illegal edges", () => {
    expect(canTransition("draft", "issued")).toBe(false); // cannot skip approval
    expect(canTransition("draft", "recalled")).toBe(false);
    expect(canTransition("recalled", "issued")).toBe(false);
    expect(() => assertTransition("draft", "issued")).toThrow(/INVALID_ISSUANCE_TRANSITION/);
    expect(() => assertTransition("recalled", "issued")).toThrow(/INVALID_ISSUANCE_TRANSITION/);
  });

  it("recalled is terminal; issued is not (recall still allowed)", () => {
    expect(isTerminal("recalled")).toBe(true);
    expect(isTerminal("issued")).toBe(false);
    expect(isTerminal("draft")).toBe(false);
    expect(isTerminal("pending_approval")).toBe(false);
    expect(canTransition("recalled", "draft")).toBe(false);
  });
});

describe("order-issuance domain — maker-checker guard", () => {
  const maker = "11111111-1111-1111-1111-111111111111";
  const checker = "22222222-2222-2222-2222-222222222222";

  it("throws MAKER_CHECKER_VIOLATION when approver === maker", () => {
    expect(() => assertDifferentApprover(maker, maker)).toThrow(/MAKER_CHECKER_VIOLATION/);
  });

  it("is case-insensitive and trims whitespace when comparing identities", () => {
    expect(() => assertDifferentApprover(maker.toUpperCase(), `  ${maker}  `)).toThrow(/MAKER_CHECKER_VIOLATION/);
  });

  it("passes when approver differs from maker", () => {
    expect(() => assertDifferentApprover(maker, checker)).not.toThrow();
  });

  it("fails closed when either identity is missing/blank", () => {
    expect(() => assertDifferentApprover(null, checker)).toThrow(/MAKER_CHECKER_VIOLATION/);
    expect(() => assertDifferentApprover(maker, undefined)).toThrow(/MAKER_CHECKER_VIOLATION/);
    expect(() => assertDifferentApprover(maker, "   ")).toThrow(/MAKER_CHECKER_VIOLATION/);
  });
});
