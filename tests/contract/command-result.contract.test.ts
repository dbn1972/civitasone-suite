/**
 * command-result.contract.test.ts — FF-01 command-result CONTRACT gate.
 *
 * Design: erp-gap-remediation/03-designs/FF-01.md §2.1 (C1), §2.4, §5, §6.4;
 * owner decision D-20 (WAVE0-DECISIONS.md §1).
 *
 * WHAT THIS GATE PROTECTS: the command-result LIBRARY surface every B/C adopter
 * (finance, asset, payroll, notification, hrms, …) and the status route in A3
 * build on. It is a cross-cutting contract, not one package's own unit test, so
 * it lives in tests/contract and is imported from the BUILT dist — the same
 * convention tests/cross-service/_helpers.ts uses (packages/queue/dist). CI
 * runs `pnpm turbo build --filter='./packages/*'` before the root vitest jobs,
 * so dist is present (.github/workflows/ci.yml).
 *
 * EXTENSIBILITY (noted for PR-FF01-A3, which edits this same file): A3 adds the
 * 202 `acceptedResponseSchema` (commandId + statusUrl) and the new
 * `commandStatusResponseSchema` from @civitasone/schemas, plus the shared
 * status-route factory. Those assertions go in their own top-level `describe`
 * blocks APPENDED below the marker at the end of this file — do not fold them
 * into the library-contract blocks here. Keep every block independent so the
 * two PRs touch disjoint regions.
 */
import { describe, it, expect } from "vitest";
import {
  CommandRefusal,
  isCommandRefusal,
  refusalCodeOf,
  isEventShapedTopic,
  recordCommandResult,
  getCommandResult,
  subscribeCommand,
  makeRecordOutcome,
  outcomeToResultInput,
  COMMAND_RESULT_RETENTION,
  DEFAULT_REFUSAL_CODE,
} from "../../packages/outbox/dist/index.js";
import { NonRetryableError } from "../../packages/queue/dist/index.js";

describe("command-result library — exported contract surface (FF-01 C1)", () => {
  it("re-exports the full command-result API from the package entrypoint", () => {
    // Adopters import everything from "@civitasone/outbox"; these must all exist.
    expect(typeof CommandRefusal).toBe("function");
    expect(typeof isCommandRefusal).toBe("function");
    expect(typeof refusalCodeOf).toBe("function");
    expect(typeof isEventShapedTopic).toBe("function");
    expect(typeof recordCommandResult).toBe("function");
    expect(typeof getCommandResult).toBe("function");
    expect(typeof subscribeCommand).toBe("function");
    expect(typeof makeRecordOutcome).toBe("function");
    expect(typeof outcomeToResultInput).toBe("function");
  });
});

describe("CommandRefusal — refusal transport contract (D-20, house rule 6)", () => {
  it("is a NonRetryableError so the bus dead-letters it without retrying", () => {
    const err = new CommandRefusal("OVER_APPROPRIATION", { shortfallMinor: "500000", currency: "INR" });
    expect(err).toBeInstanceOf(NonRetryableError);
    expect((err as unknown as { nonRetryable: boolean }).nonRetryable).toBe(true);
  });

  it("carries a stable code + non-PII params, and keeps free text off the public surface", () => {
    const err = new CommandRefusal(
      "SOD_VIOLATION",
      { stage: "2", currency: "INR" },
      "maker 7 equals checker 7 on bill 9 — operator only",
    );
    expect(err.code).toBe("SOD_VIOLATION");
    expect(err.params).toMatchObject({ stage: "2", currency: "INR" });
    expect(isCommandRefusal(err)).toBe(true);
    // Money, when present in params, is bigint minor units as a string + ISO code (house rule 4).
    const money = new CommandRefusal("OVER_APPROPRIATION", { shortfallMinor: "50000000", currency: "INR" });
    expect(typeof money.params.shortfallMinor).toBe("string");
    expect(money.params.currency).toBe("INR");
  });
});

describe("refusalCodeOf — legacy message → stable code (gl/refusal.ts convention)", () => {
  const cases: Array<[unknown, string]> = [
    [new CommandRefusal("OVER_APPROPRIATION"), "OVER_APPROPRIATION"],
    [new Error("[finance/payments] OVER_APPROPRIATION: bill exceeds allocation"), "OVER_APPROPRIATION"],
    [new Error("PERIOD_CLOSED: cannot post"), "PERIOD_CLOSED"],
    [new Error("UNKNOWN_ACCOUNT_CODE - no such head"), "UNKNOWN_ACCOUNT_CODE"],
    [{ code: "SOD_VIOLATION", message: "x" }, "SOD_VIOLATION"],
    [new Error("free text with no code"), DEFAULT_REFUSAL_CODE],
    [null, DEFAULT_REFUSAL_CODE],
  ];
  it.each(cases)("parses %o to %s", (input, expected) => {
    expect(refusalCodeOf(input)).toBe(expected);
  });

  it("never returns anything but an uppercase token or the default (no free text leak)", () => {
    for (const input of [new Error("Lowercase words here"), {}, undefined, 42]) {
      expect(refusalCodeOf(input)).toMatch(/^[A-Z][A-Z0-9_]+$/);
    }
  });
});

describe("isEventShapedTopic — silo-safety guard (FF-01 §3.4)", () => {
  it("rejects event-shaped (past-tense) topics and accepts command topics", () => {
    expect(isEventShapedTopic("finance.gl.rejected")).toBe(true);
    expect(isEventShapedTopic("payroll.run.disbursed")).toBe(true);
    expect(isEventShapedTopic("finance.bill.create")).toBe(false);
    expect(isEventShapedTopic("payroll.run.repost")).toBe(false);
  });

  it("subscribeCommand refuses an event-shaped topic before subscribing", () => {
    const queue = { subscribe: () => { throw new Error("must not subscribe"); } } as never;
    expect(() => subscribeCommand(queue, "finance.gl.rejected", async () => {}, async () => {})).toThrow(
      /event-shaped topic/,
    );
  });
});

describe("D-20 retention policy exposed by the library (tables land in B/C)", () => {
  it("is 30 days for rejected/failed and 7 for succeeded, and is frozen", () => {
    expect(COMMAND_RESULT_RETENTION).toEqual({ rejected: 30, failed: 30, succeeded: 7 });
    expect(Object.isFrozen(COMMAND_RESULT_RETENTION)).toBe(true);
  });
});

describe("outcomeToResultInput — bus outcome → persisted-result mapping", () => {
  it("derives a code and retryable flag for failed, leaves success bare", () => {
    const failed = outcomeToResultInput({
      messageId: "m",
      tenantId: "t",
      topic: "finance.bill.create",
      status: "failed",
      reason: "PERIOD_CLOSED: dependency down",
    });
    expect(failed.code).toBe("PERIOD_CLOSED");
    expect(failed.retryable).toBe(true);

    const ok = outcomeToResultInput({ messageId: "m", tenantId: "t", topic: "finance.bill.create", status: "succeeded" });
    expect(ok.code).toBeUndefined();
    expect(ok.retryable).toBe(false);
  });
});

// ===========================================================================
// PR-FF01-A3 APPEND POINT — add the 202 acceptedResponseSchema (commandId +
// statusUrl) and commandStatusResponseSchema contract blocks BELOW this marker,
// each as its own top-level describe(). Do not edit the blocks above.
// ===========================================================================
