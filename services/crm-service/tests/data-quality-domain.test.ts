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

// ── GAP-CRM-DATA-QUALITY-01 / -03: named drill-down rows + all-filters-in-one ──
describe("buildReport drill-down rows (GAP-CRM-DATA-QUALITY-01)", () => {
  const now = new Date("2026-08-04T00:00:00Z");
  const full = { email: "a@b.com", phone: "9876543210", company: "C", designation: "D", city: "E", leadSource: "F" };
  const records: RecordInput[] = [
    { id: "c-missing", attributes: { name: "  Asha Verma  " }, lastActivityAt: now },
    { id: "c-invalid", attributes: { name: "Ravi Kumar", ...full, phone: "999" }, lastActivityAt: now },
    { id: "c-stale", attributes: { name: "Meena Das", ...full }, lastActivityAt: "2020-01-01T00:00:00Z" },
    { id: "c-noname", attributes: { name: "   " }, lastActivityAt: now },
  ];

  it("classifyRecord carries the trimmed display name and machine-readable issue codes", () => {
    const c = classifyRecord(records[0]!, "contacts", 90, now);
    expect(c.name).toBe("Asha Verma");
    expect(c.issues).toContain("missing:email");
    expect(c.issues).not.toContain("stale");

    const inv = classifyRecord(records[1]!, "contacts", 90, now);
    expect(inv.issues).toEqual(["invalid:phone"]);

    const stale = classifyRecord(records[2]!, "contacts", 90, now);
    expect(stale.issues).toEqual(["stale"]);
  });

  it("a blank name is reported as null, never an empty string", () => {
    expect(classifyRecord(records[3]!, "contacts", 90, now).name).toBeNull();
  });

  it("a single-filter report returns named rows with a 0..1 score alongside the legacy filteredIds", () => {
    const rep = buildReport(records, "contacts", { staleDays: 90, filter: "invalid", now });
    expect(rep.filteredIds).toEqual(["c-invalid"]);
    expect(rep.records).toEqual([
      { id: "c-invalid", name: "Ravi Kumar", score: 1, issues: ["invalid:phone"] },
    ]);
    expect(rep.recordsByFilter).toBeUndefined();
  });

  it("score is a fraction of 1, not of 100", () => {
    const rep = buildReport(records, "contacts", { staleDays: 90, filter: "missing", now });
    const row = rep.records.find((r) => r.id === "c-missing")!;
    // name only = 20 of 100.
    expect(row.score).toBeCloseTo(0.2, 5);
  });

  it("an account report carries the account name", () => {
    const accts: RecordInput[] = [
      { id: "a1", attributes: { name: "NIC Odisha", industry: null }, lastActivityAt: now },
    ];
    const rep = buildReport(accts, "accounts", { staleDays: 90, filter: "missing", now });
    expect(rep.records[0]).toMatchObject({ id: "a1", name: "NIC Odisha" });
    expect(rep.records[0]!.issues).toContain("missing:industry");
  });

  it("no filter returns no rows", () => {
    const rep = buildReport(records, "contacts", { staleDays: 90, now });
    expect(rep.records).toEqual([]);
    expect(rep.recordsByFilter).toBeUndefined();
  });
});

describe("buildReport filter=all (GAP-CRM-DATA-QUALITY-03)", () => {
  const now = new Date("2026-08-04T00:00:00Z");
  const full = { email: "a@b.com", phone: "9876543210", company: "C", designation: "D", city: "E", leadSource: "F" };
  const records: RecordInput[] = [
    { id: "m", attributes: { name: "Only name" }, lastActivityAt: now },
    { id: "i", attributes: { name: "Bad phone", ...full, phone: "999" }, lastActivityAt: now },
    { id: "s", attributes: { name: "Old", ...full }, lastActivityAt: "2020-01-01T00:00:00Z" },
  ];

  it("returns the rows of every filter in one response, with the same counts as a single-filter call", () => {
    const all = buildReport(records, "contacts", { staleDays: 90, filter: "all", now });
    expect(all.filter).toBe("all");
    expect(all.recordsByFilter?.missing.map((r) => r.id)).toEqual(["m"]);
    expect(all.recordsByFilter?.invalid.map((r) => r.id)).toEqual(["i"]);
    expect(all.recordsByFilter?.stale.map((r) => r.id)).toEqual(["s"]);
    // The single-list fields stay empty so a client cannot mistake them for one filter's rows.
    expect(all.records).toEqual([]);
    expect(all.filteredIds).toEqual([]);

    const one = buildReport(records, "contacts", { staleDays: 90, filter: "missing", now });
    expect(all.counts).toEqual(one.counts);
    expect(all.distribution).toEqual(one.distribution);
  });

  it("a record that matches several filters appears under each of them", () => {
    const both: RecordInput[] = [
      { id: "x", attributes: { name: "X", phone: "999" }, lastActivityAt: "2020-01-01T00:00:00Z" },
    ];
    const all = buildReport(both, "contacts", { staleDays: 90, filter: "all", now });
    expect(all.recordsByFilter?.missing).toHaveLength(1);
    expect(all.recordsByFilter?.invalid).toHaveLength(1);
    expect(all.recordsByFilter?.stale).toHaveLength(1);
  });

  it("caps each filter's list independently at idLimit while counts stay uncapped", () => {
    const many: RecordInput[] = Array.from({ length: 7 }, (_, n) => ({
      id: `r${n}`,
      attributes: { name: `R${n}` },
      lastActivityAt: now,
    }));
    const all = buildReport(many, "contacts", { staleDays: 90, filter: "all", now, idLimit: 3 });
    expect(all.recordsByFilter?.missing).toHaveLength(3);
    expect(all.counts.missing).toBe(7);
  });
});
