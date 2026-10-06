import { describe, it, expect } from "vitest";
import { deriveTenderStatus } from "./format";

const NOW = Date.UTC(2026, 9, 6, 0, 0, 0); // fixed reference

describe("deriveTenderStatus (GAP-WORKS-TENDERS-01 / DETAIL-05)", () => {
  it("reports 'Awarded' when an award exists, regardless of date", () => {
    const v = deriveTenderStatus({ openingDate: new Date(NOW + 86_400_000).toISOString(), awarded: true, now: NOW });
    expect(v.key).toBe("awarded");
    expect(v.label).toBe("Awarded");
    expect(v.tone).toBe("good");
  });

  it("does NOT invent 'open'/'closed' from the opening date", () => {
    const future = deriveTenderStatus({ openingDate: new Date(NOW + 86_400_000).toISOString(), now: NOW });
    const past = deriveTenderStatus({ openingDate: new Date(NOW - 86_400_000).toISOString(), now: NOW });
    expect(future.label).toBe("Upcoming");
    expect(past.label).toBe("Opening date passed");
    expect([future.label, past.label]).not.toContain("Open");
    expect([future.label, past.label]).not.toContain("Closed");
  });

  it("shows '—' for a missing or unparseable opening date", () => {
    expect(deriveTenderStatus({ openingDate: null, now: NOW }).label).toBe("—");
    expect(deriveTenderStatus({ openingDate: "not-a-date", now: NOW }).label).toBe("—");
  });

  it("uses an explicit backend status verbatim (humanised) when supplied", () => {
    const v = deriveTenderStatus({ openingDate: null, backendStatus: "under_evaluation", now: NOW });
    expect(v.label).toBe("Under evaluation");
  });
});
