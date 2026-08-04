/**
 * DQ-004 — data-quality domain logic (pure).
 */
import { describe, it, expect } from "vitest";
import {
  computeCompletenessWith,
  COMPLETENESS_PROFILES,
  bucketFor,
  isStale,
  classifyRecord,
  buildReport,
  type RecordInput,
} from "../src/modules/dashboard/data-quality.js";

describe("computeCompletenessWith", () => {
  it("scores contacts profile to 100 when all filled", () => {
    const r = computeCompletenessWith(
      { name: "A", email: "a@b.com", phone: "1", company: "C", designation: "D", city: "E", leadSource: "F" },
      COMPLETENESS_PROFILES.contacts,
    );
    expect(r.score).toBe(100);
    expect(r.missingFields).toHaveLength(0);
  });
  it("accounts profile weights sum to 100", () => {
    const total = COMPLETENESS_PROFILES.accounts.reduce((s, f) => s + f.weight, 0);
    expect(total).toBe(100);
  });
  it("treats empty/null/undefined as missing", () => {
    const r = computeCompletenessWith({ name: "", email: null, phone: undefined }, COMPLETENESS_PROFILES.contacts);
    expect(r.score).toBe(0);
  });
});

describe("bucketFor", () => {
  it("maps scores to buckets", () => {
    expect(bucketFor(0)).toBe("0-20");
    expect(bucketFor(20)).toBe("0-20");
    expect(bucketFor(21)).toBe("21-40");
    expect(bucketFor(100)).toBe("81-100");
  });
});

describe("isStale", () => {
  const now = new Date("2026-08-04T00:00:00Z");
  it("treats never-touched records as stale", () => {
    expect(isStale(null, 90, now)).toBe(true);
  });
  it("flags records older than staleDays", () => {
    expect(isStale("2026-01-01T00:00:00Z", 90, now)).toBe(true);
  });
  it("keeps recent records fresh", () => {
    expect(isStale("2026-07-20T00:00:00Z", 90, now)).toBe(false);
  });
});

describe("classifyRecord", () => {
  const now = new Date("2026-08-04T00:00:00Z");
  it("flags missing + invalid + stale", () => {
    const rec: RecordInput = {
      id: "x",
      attributes: { name: "A", phone: "123" }, // phone invalid, others missing
      lastActivityAt: "2026-01-01T00:00:00Z",
    };
    const c = classifyRecord(rec, "contacts", 90, now);
    expect(c.hasMissing).toBe(true);
    expect(c.hasInvalid).toBe(true);
    expect(c.isStale).toBe(true);
  });
  it("a complete, valid, recent record is clean", () => {
    const rec: RecordInput = {
      id: "y",
      attributes: {
        name: "A", email: "a@b.com", phone: "9876543210", company: "C",
        designation: "D", city: "E", leadSource: "F", pincode: "560001",
      },
      lastActivityAt: now,
    };
    const c = classifyRecord(rec, "contacts", 90, now);
    expect(c.hasMissing).toBe(false);
    expect(c.hasInvalid).toBe(false);
    expect(c.isStale).toBe(false);
    expect(c.score).toBe(100);
  });
});

describe("buildReport", () => {
  const now = new Date("2026-08-04T00:00:00Z");
  const records: RecordInput[] = [
    { id: "clean", attributes: { name: "A", email: "a@b.com", phone: "9876543210", company: "C", designation: "D", city: "E", leadSource: "F" }, lastActivityAt: now },
    { id: "missing", attributes: { name: "B" }, lastActivityAt: now },
    { id: "invalid", attributes: { name: "C", email: "c@d.com", phone: "999", company: "C", designation: "D", city: "E", leadSource: "F" }, lastActivityAt: now },
    { id: "stale", attributes: { name: "D", email: "d@e.com", phone: "9876543210", company: "C", designation: "D", city: "E", leadSource: "F" }, lastActivityAt: "2020-01-01T00:00:00Z" },
  ];

  it("counts missing/invalid/stale and builds a distribution", () => {
    const rep = buildReport(records, "contacts", { staleDays: 90, now });
    expect(rep.total).toBe(4);
    expect(rep.counts.missing).toBe(1);
    expect(rep.counts.invalid).toBe(1);
    expect(rep.counts.stale).toBe(1);
    const sum = Object.values(rep.distribution).reduce((s, n) => s + n, 0);
    expect(sum).toBe(4);
  });

  it("returns filtered ids for the missing filter", () => {
    const rep = buildReport(records, "contacts", { staleDays: 90, filter: "missing", now });
    expect(rep.filteredIds).toEqual(["missing"]);
  });

  it("returns filtered ids for the invalid filter", () => {
    const rep = buildReport(records, "contacts", { staleDays: 90, filter: "invalid", now });
    expect(rep.filteredIds).toEqual(["invalid"]);
  });

  it("returns filtered ids for the stale filter", () => {
    const rep = buildReport(records, "contacts", { staleDays: 90, filter: "stale", now });
    expect(rep.filteredIds).toEqual(["stale"]);
  });

  it("no filter returns empty filteredIds", () => {
    const rep = buildReport(records, "contacts", { staleDays: 90, now });
    expect(rep.filteredIds).toEqual([]);
    expect(rep.filter).toBeNull();
  });
});
