/** CAP-026 — quorum tally + parallel consolidation pure domain. */
import { describe, it, expect } from "vitest";
import { tallyQuorum, consolidateParallel, type VoteChoice } from "../src/modules/quorum/domain.js";

const v = (...xs: VoteChoice[]) => xs;

describe("tallyQuorum — majority", () => {
  it("approves once approvals exceed half the membership", () => {
    const t = tallyQuorum({ rule: "majority", totalMembers: 5, votes: v("approve", "approve", "approve") });
    expect(t.decided).toBe(true);
    expect(t.outcome).toBe("approve");
  });
  it("stays pending before a majority is reached", () => {
    const t = tallyQuorum({ rule: "majority", totalMembers: 5, votes: v("approve", "approve") });
    expect(t.decided).toBe(false);
    expect(t.outcome).toBeNull();
  });
  it("rejects once approval is mathematically unreachable", () => {
    const t = tallyQuorum({ rule: "majority", totalMembers: 5, votes: v("reject", "reject", "reject") });
    expect(t.decided).toBe(true);
    expect(t.outcome).toBe("reject");
  });
});

describe("tallyQuorum — unanimous", () => {
  it("approves only when every member approves", () => {
    expect(tallyQuorum({ rule: "unanimous", totalMembers: 3, votes: v("approve", "approve", "approve") }).outcome).toBe("approve");
    expect(tallyQuorum({ rule: "unanimous", totalMembers: 3, votes: v("approve", "approve") }).decided).toBe(false);
  });
  it("rejects the instant any member rejects", () => {
    const t = tallyQuorum({ rule: "unanimous", totalMembers: 3, votes: v("approve", "reject") });
    expect(t.outcome).toBe("reject");
  });
  it("rejects when all voted but an abstention broke unanimity", () => {
    const t = tallyQuorum({ rule: "unanimous", totalMembers: 3, votes: v("approve", "approve", "abstain") });
    expect(t.decided).toBe(true);
    expect(t.outcome).toBe("reject");
  });
});

describe("tallyQuorum — threshold", () => {
  it("approves once approvals reach the threshold", () => {
    const t = tallyQuorum({ rule: "threshold", totalMembers: 7, threshold: 3, votes: v("approve", "approve", "approve") });
    expect(t.outcome).toBe("approve");
  });
  it("rejects once the threshold is unreachable", () => {
    const t = tallyQuorum({ rule: "threshold", totalMembers: 4, threshold: 3, votes: v("reject", "reject") });
    expect(t.decided).toBe(true);
    expect(t.outcome).toBe("reject");
  });
});

describe("tallyQuorum — edge cases", () => {
  it("returns undecided for zero membership", () => {
    expect(tallyQuorum({ rule: "majority", totalMembers: 0, votes: [] }).decided).toBe(false);
  });
});

describe("consolidateParallel — all-must", () => {
  it("approves only when all branches approve", () => {
    expect(consolidateParallel("all", ["approve", "approve"]).outcome).toBe("approve");
    expect(consolidateParallel("all", ["approve", "pending"]).outcome).toBe("pending");
    expect(consolidateParallel("all", ["approve", "reject"]).outcome).toBe("reject");
  });
});

describe("consolidateParallel — any", () => {
  it("approves on the first branch approval and rejects only when all reject", () => {
    expect(consolidateParallel("any", ["reject", "approve"]).outcome).toBe("approve");
    expect(consolidateParallel("any", ["reject", "reject"]).outcome).toBe("reject");
    expect(consolidateParallel("any", ["reject", "pending"]).outcome).toBe("pending");
  });
});
