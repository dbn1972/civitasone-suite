import { describe, it, expect } from "vitest";
import {
  blockRateBand,
  mapAgentStatuses,
  mapAuditEntries,
  mapGovernanceCounters,
  topBlockReasons,
  type AuditEntry,
} from "./governance";

function entry(over: Partial<AuditEntry> = {}): AuditEntry {
  return {
    id: "a",
    agentId: null,
    action: "invoke",
    blocked: false,
    reason: null,
    createdAt: "2026-08-01T00:00:00.000Z",
    ...over,
  };
}

describe("mapGovernanceCounters", () => {
  it("reads the dashboard counters from the data envelope", () => {
    expect(
      mapGovernanceCounters({
        data: { totalInvocations: 400, blockedCount: 8, blockRatePct: 2, activeAgents: 3 },
      }),
    ).toEqual({ totalInvocations: 400, blockedCount: 8, blockRatePct: 2, activeAgents: 3 });
  });

  it("accepts the summary endpoint's total/blocked naming", () => {
    expect(mapGovernanceCounters({ data: { total: 50, blocked: 5, blockRatePct: 10 } })).toEqual({
      totalInvocations: 50,
      blockedCount: 5,
      blockRatePct: 10,
      activeAgents: 0,
    });
  });

  it("derives the block rate when the service omits it", () => {
    const counters = mapGovernanceCounters({ data: { totalInvocations: 8, blockedCount: 1 } });

    expect(counters?.blockRatePct).toBe(12.5);
  });

  it("reports a zero rate rather than dividing by zero", () => {
    expect(mapGovernanceCounters({ data: { totalInvocations: 0, blockedCount: 0 } })?.blockRatePct).toBe(0);
  });

  it("returns null for a payload that is not an object", () => {
    expect(mapGovernanceCounters(null)).toBeNull();
    expect(mapGovernanceCounters([1, 2])).toBeNull();
  });
});

describe("mapAuditEntries", () => {
  it("maps audit rows and treats a missing blocked flag as not blocked", () => {
    const mapped = mapAuditEntries({
      data: [
        { id: "1", agentId: "ag-1", action: "invoke", blocked: true, reason: "pii", createdAt: "2026-08-01T10:00:00.000Z" },
        { id: "2", action: "summarize", createdAt: "2026-08-01T11:00:00.000Z" },
      ],
    });

    expect(mapped).toEqual([
      { id: "1", agentId: "ag-1", action: "invoke", blocked: true, reason: "pii", createdAt: "2026-08-01T10:00:00.000Z" },
      { id: "2", agentId: null, action: "summarize", blocked: false, reason: null, createdAt: "2026-08-01T11:00:00.000Z" },
    ]);
  });

  it("skips rows missing an id, action or timestamp", () => {
    const mapped = mapAuditEntries([
      { id: "1", action: "invoke" },
      { action: "invoke", createdAt: "2026-08-01T10:00:00.000Z" },
      { id: "3", action: "invoke", createdAt: "2026-08-01T10:00:00.000Z" },
    ]);

    expect(mapped?.map((r) => r.id)).toEqual(["3"]);
  });

  it("returns null when the payload is not a list", () => {
    expect(mapAuditEntries({ summary: {} })).toBeNull();
  });
});

describe("mapAgentStatuses", () => {
  it("defaults an absent status to unknown", () => {
    expect(mapAgentStatuses({ data: [{ id: "ag-1", name: "Triage" }] })).toEqual([
      { id: "ag-1", name: "Triage", status: "unknown" },
    ]);
  });

  it("returns null when the payload is not a list", () => {
    expect(mapAgentStatuses("nope")).toBeNull();
  });
});

describe("blockRateBand", () => {
  it("treats a low rate as normal", () => {
    expect(blockRateBand(0)).toBe("normal");
    expect(blockRateBand(4.99)).toBe("normal");
  });

  it("flags 5% and above as elevated", () => {
    expect(blockRateBand(5)).toBe("elevated");
    expect(blockRateBand(19.9)).toBe("elevated");
  });

  it("flags 20% and above as critical", () => {
    expect(blockRateBand(20)).toBe("critical");
    expect(blockRateBand(97)).toBe("critical");
  });
});

describe("topBlockReasons", () => {
  it("counts only blocked entries, most frequent first", () => {
    const reasons = topBlockReasons([
      entry({ blocked: true, reason: "pii" }),
      entry({ blocked: true, reason: "pii" }),
      entry({ blocked: true, reason: "injection" }),
      entry({ blocked: false, reason: "pii" }),
    ]);

    expect(reasons).toEqual([
      { reason: "pii", count: 2 },
      { reason: "injection", count: 1 },
    ]);
  });

  it("labels a blocked entry with no reason as unspecified", () => {
    expect(topBlockReasons([entry({ blocked: true })])).toEqual([{ reason: "Unspecified", count: 1 }]);
  });

  it("caps the list at the requested limit", () => {
    const entries = ["a", "b", "c", "d"].map((r) => entry({ blocked: true, reason: r }));

    expect(topBlockReasons(entries, 2)).toHaveLength(2);
  });

  it("returns nothing when no entry was blocked", () => {
    expect(topBlockReasons([entry(), entry()])).toEqual([]);
  });
});
