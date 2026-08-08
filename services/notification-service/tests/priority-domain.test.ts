/**
 * Pack #20 — Priority: domain logic for priority classification,
 * retry policies, and DND/digest bypass rules.
 */
import { describe, it, expect } from "vitest";
import { classify, getRetryPolicy, shouldBypassDnd, shouldBypassDigest } from "../src/modules/priority/domain.js";
import type { PriorityLevel } from "../src/modules/priority/types.js";

describe("classify — priority level mapping", () => {
  it("returns 'critical' for explicit 'critical'", () => {
    expect(classify("critical")).toBe("critical");
  });

  it("returns 'high' for explicit 'high'", () => {
    expect(classify("high")).toBe("high");
  });

  it("returns 'normal' for explicit 'normal'", () => {
    expect(classify("normal")).toBe("normal");
  });

  it("returns 'low' for explicit 'low'", () => {
    expect(classify("low")).toBe("low");
  });

  it("defaults to 'normal' when undefined", () => {
    expect(classify(undefined)).toBe("normal");
  });

  it("defaults to 'normal' for an unrecognised string", () => {
    expect(classify("urgent")).toBe("normal");
    expect(classify("")).toBe("normal");
    expect(classify("CRITICAL")).toBe("normal"); // case-sensitive
  });
});

describe("getRetryPolicy — retry attempts and backoff per level", () => {
  it("critical gets 5 attempts with exponential backoff", () => {
    const policy = getRetryPolicy("critical");
    expect(policy.maxAttempts).toBe(5);
    expect(policy.backoffMs).toHaveLength(5);
    expect(policy.backoffMs[0]).toBe(1000);
    expect(policy.backoffMs[4]).toBe(16000);
  });

  it("high gets 5 attempts", () => {
    const policy = getRetryPolicy("high");
    expect(policy.maxAttempts).toBe(5);
    expect(policy.backoffMs).toHaveLength(5);
  });

  it("normal gets 3 attempts", () => {
    const policy = getRetryPolicy("normal");
    expect(policy.maxAttempts).toBe(3);
    expect(policy.backoffMs).toHaveLength(3);
  });

  it("low gets 1 attempt with no retries", () => {
    const policy = getRetryPolicy("low");
    expect(policy.maxAttempts).toBe(1);
    expect(policy.backoffMs).toHaveLength(0);
  });

  it("backoff is strictly monotonically increasing for all levels with retries", () => {
    const levels: PriorityLevel[] = ["critical", "high", "normal"];
    for (const level of levels) {
      const { backoffMs } = getRetryPolicy(level);
      for (let i = 1; i < backoffMs.length; i++) {
        expect(backoffMs[i]).toBeGreaterThan(backoffMs[i - 1]!);
      }
    }
  });
});

describe("shouldBypassDnd — only critical bypasses DND", () => {
  it("critical bypasses DND", () => {
    expect(shouldBypassDnd("critical")).toBe(true);
  });

  it("high does NOT bypass DND", () => {
    expect(shouldBypassDnd("high")).toBe(false);
  });

  it("normal does NOT bypass DND", () => {
    expect(shouldBypassDnd("normal")).toBe(false);
  });

  it("low does NOT bypass DND", () => {
    expect(shouldBypassDnd("low")).toBe(false);
  });
});

describe("shouldBypassDigest — only critical bypasses digest batching", () => {
  it("critical bypasses digest", () => {
    expect(shouldBypassDigest("critical")).toBe(true);
  });

  it("high does NOT bypass digest", () => {
    expect(shouldBypassDigest("high")).toBe(false);
  });

  it("normal does NOT bypass digest", () => {
    expect(shouldBypassDigest("normal")).toBe(false);
  });

  it("low does NOT bypass digest", () => {
    expect(shouldBypassDigest("low")).toBe(false);
  });
});
