/**
 * G17 — Due-horizon work-queue generator: domain logic tests.
 *
 * Verifies the pure functions that compute horizon windows, filter
 * subscriptions by activity/consent, and group items by org-unit dimension.
 */
import { describe, it, expect } from "vitest";
import {
  computeHorizonWindow,
  shouldInclude,
  groupItems,
  filterByWindow,
  GROUP_BY_VALUES,
  type SubscriptionItem,
  type HorizonConfig,
  type WorkQueueItem,
} from "../src/modules/due-horizon/domain.js";

// ─── computeHorizonWindow ─────────────────────────────────────────────────────

describe("computeHorizonWindow", () => {
  it("returns a window starting at midnight of `now` and ending horizonDays later at end-of-day", () => {
    const now = new Date("2025-03-15T14:30:00Z");
    const w = computeHorizonWindow(now, 30);
    expect(w.from.getHours()).toBe(0);
    expect(w.from.getMinutes()).toBe(0);
    expect(w.from.getSeconds()).toBe(0);
    expect(w.to.getHours()).toBe(23);
    expect(w.to.getMinutes()).toBe(59);
    expect(w.to.getSeconds()).toBe(59);
  });

  it("the 'to' date is horizonDays ahead of the 'from' date", () => {
    const now = new Date("2025-01-01T00:00:00Z");
    const w = computeHorizonWindow(now, 60);
    // from starts at midnight, to is end-of-day on the 60th day from now
    const toMidnight = new Date(w.to);
    toMidnight.setHours(0, 0, 0, 0);
    const fromMidnight = new Date(w.from);
    const diffDays = Math.round((toMidnight.getTime() - fromMidnight.getTime()) / (1000 * 60 * 60 * 24));
    expect(diffDays).toBe(60);
  });

  it("handles single-day horizon", () => {
    const now = new Date("2025-06-10T09:00:00Z");
    const w = computeHorizonWindow(now, 1);
    expect(w.from.getDate()).toBe(10);
    expect(w.to.getDate()).toBe(11);
  });

  it("crosses month boundaries correctly", () => {
    const now = new Date("2025-01-28T12:00:00Z");
    const w = computeHorizonWindow(now, 7);
    // Jan has 31 days, so from Jan 28, +7 = Feb 4
    expect(w.to.getMonth()).toBe(1); // February
    expect(w.to.getDate()).toBe(4);
  });

  it("handles year boundary", () => {
    const now = new Date("2025-12-30T10:00:00Z");
    const w = computeHorizonWindow(now, 7);
    expect(w.to.getFullYear()).toBe(2026);
    expect(w.to.getMonth()).toBe(0); // January
  });

  it("produces deterministic output for the same inputs", () => {
    const now = new Date("2025-05-15T08:00:00Z");
    const w1 = computeHorizonWindow(now, 30);
    const w2 = computeHorizonWindow(now, 30);
    expect(w1.from.getTime()).toBe(w2.from.getTime());
    expect(w1.to.getTime()).toBe(w2.to.getTime());
  });
});

// ─── shouldInclude ────────────────────────────────────────────────────────────

describe("shouldInclude", () => {
  const baseConfig: HorizonConfig = { consentRequired: true, groupBy: "product", active: true };

  const activeSub: SubscriptionItem = {
    id: "sub-1",
    contactId: "c-1",
    productId: "p-1",
    amountMinor: 100000n,
    frequency: "monthly",
    status: "active",
    nextDueDate: "2025-04-01",
    consentGiven: true,
  };

  it("includes an active subscription with consent when consent is required", () => {
    expect(shouldInclude(activeSub, baseConfig)).toBe(true);
  });

  it("excludes a cancelled subscription", () => {
    const sub = { ...activeSub, status: "cancelled" };
    expect(shouldInclude(sub, baseConfig)).toBe(false);
  });

  it("excludes a paused subscription", () => {
    const sub = { ...activeSub, status: "paused" };
    expect(shouldInclude(sub, baseConfig)).toBe(false);
  });

  it("excludes when consent is required but not given", () => {
    const sub = { ...activeSub, consentGiven: false };
    expect(shouldInclude(sub, baseConfig)).toBe(false);
  });

  it("includes when consent is not required regardless of consent status", () => {
    const noConsentConfig: HorizonConfig = { ...baseConfig, consentRequired: false };
    const sub = { ...activeSub, consentGiven: false };
    expect(shouldInclude(sub, noConsentConfig)).toBe(true);
  });

  it("includes when consent field is undefined (treats as given)", () => {
    const sub = { ...activeSub, consentGiven: undefined };
    expect(shouldInclude(sub, baseConfig)).toBe(true);
  });

  it("only checks status is exactly 'active'", () => {
    for (const status of ["expired", "suspended", "inactive", "closed"]) {
      expect(shouldInclude({ ...activeSub, status }, baseConfig)).toBe(false);
    }
  });
});

// ─── groupItems ───────────────────────────────────────────────────────────────

describe("groupItems", () => {
  const subs: SubscriptionItem[] = [
    { id: "s1", contactId: "c1", productId: "p-alpha", amountMinor: 1000n, frequency: "monthly", status: "active", nextDueDate: "2025-04-01", ownerId: "owner-a", region: "north" },
    { id: "s2", contactId: "c2", productId: "p-alpha", amountMinor: 2000n, frequency: "monthly", status: "active", nextDueDate: "2025-04-02", ownerId: "owner-b", region: "south" },
    { id: "s3", contactId: "c3", productId: "p-beta", amountMinor: 3000n, frequency: "quarterly", status: "active", nextDueDate: "2025-04-03", ownerId: "owner-a", region: "north" },
  ];

  const items: WorkQueueItem[] = [
    { subscriptionId: "s1", contactId: "c1", productId: "p-alpha", amountMinor: 1000n, frequency: "monthly", nextDueDate: "2025-04-01" },
    { subscriptionId: "s2", contactId: "c2", productId: "p-alpha", amountMinor: 2000n, frequency: "monthly", nextDueDate: "2025-04-02" },
    { subscriptionId: "s3", contactId: "c3", productId: "p-beta", amountMinor: 3000n, frequency: "quarterly", nextDueDate: "2025-04-03" },
  ];

  it("groups by product — items with same productId land in same bucket", () => {
    const grouped = groupItems(items, "product", subs);
    expect(grouped.get("p-alpha")?.length).toBe(2);
    expect(grouped.get("p-beta")?.length).toBe(1);
  });

  it("groups by region — uses subscription's region field", () => {
    const grouped = groupItems(items, "region", subs);
    expect(grouped.get("north")?.length).toBe(2);
    expect(grouped.get("south")?.length).toBe(1);
  });

  it("groups by owner — uses subscription's ownerId field", () => {
    const grouped = groupItems(items, "owner", subs);
    expect(grouped.get("owner-a")?.length).toBe(2);
    expect(grouped.get("owner-b")?.length).toBe(1);
  });

  it("uses 'unassigned' when region is null", () => {
    const subsNoRegion = subs.map((s) => ({ ...s, region: null }));
    const grouped = groupItems(items, "region", subsNoRegion);
    expect(grouped.get("unassigned")?.length).toBe(3);
  });

  it("uses 'unassigned' when ownerId is null", () => {
    const subsNoOwner = subs.map((s) => ({ ...s, ownerId: null }));
    const grouped = groupItems(items, "owner", subsNoOwner);
    expect(grouped.get("unassigned")?.length).toBe(3);
  });

  it("returns empty map for empty items", () => {
    const grouped = groupItems([], "product", []);
    expect(grouped.size).toBe(0);
  });

  it("preserves all items — no items lost during grouping", () => {
    const grouped = groupItems(items, "product", subs);
    const totalItems = [...grouped.values()].reduce((sum, arr) => sum + arr.length, 0);
    expect(totalItems).toBe(items.length);
  });
});

// ─── filterByWindow ───────────────────────────────────────────────────────────

describe("filterByWindow", () => {
  const config: HorizonConfig = { consentRequired: false, groupBy: "product", active: true };

  const baseSubs: SubscriptionItem[] = [
    { id: "s1", contactId: "c1", productId: "p1", amountMinor: 5000n, frequency: "monthly", status: "active", nextDueDate: "2025-04-10", consentGiven: true },
    { id: "s2", contactId: "c2", productId: "p1", amountMinor: 7000n, frequency: "monthly", status: "active", nextDueDate: "2025-04-20", consentGiven: true },
    { id: "s3", contactId: "c3", productId: "p2", amountMinor: 3000n, frequency: "quarterly", status: "active", nextDueDate: "2025-05-15", consentGiven: true },
    { id: "s4", contactId: "c4", productId: "p2", amountMinor: 4000n, frequency: "monthly", status: "cancelled", nextDueDate: "2025-04-12", consentGiven: true },
    { id: "s5", contactId: "c5", productId: "p3", amountMinor: 6000n, frequency: "monthly", status: "active", nextDueDate: null, consentGiven: true },
  ];

  it("includes subscriptions whose next_due_date falls within the window", () => {
    const window = { from: new Date("2025-04-01T00:00:00Z"), to: new Date("2025-04-30T23:59:59.999Z") };
    const result = filterByWindow(baseSubs, window, config);
    // s1 (Apr 10), s2 (Apr 20) are in window; s3 (May 15) is out; s4 cancelled; s5 null date
    expect(result.length).toBe(2);
    expect(result.map((r) => r.subscriptionId).sort()).toEqual(["s1", "s2"]);
  });

  it("excludes subscriptions with null nextDueDate", () => {
    const window = { from: new Date("2025-01-01T00:00:00Z"), to: new Date("2025-12-31T23:59:59.999Z") };
    const result = filterByWindow(baseSubs, window, config);
    expect(result.find((r) => r.subscriptionId === "s5")).toBeUndefined();
  });

  it("excludes inactive subscriptions", () => {
    const window = { from: new Date("2025-04-01T00:00:00Z"), to: new Date("2025-04-30T23:59:59.999Z") };
    const result = filterByWindow(baseSubs, window, config);
    expect(result.find((r) => r.subscriptionId === "s4")).toBeUndefined();
  });

  it("excludes subscriptions without consent when config requires it", () => {
    const consentConfig: HorizonConfig = { ...config, consentRequired: true };
    const subs = [
      { ...baseSubs[0]!, consentGiven: false },
      { ...baseSubs[1]!, consentGiven: true },
    ];
    const window = { from: new Date("2025-04-01T00:00:00Z"), to: new Date("2025-04-30T23:59:59.999Z") };
    const result = filterByWindow(subs, window, consentConfig);
    expect(result.length).toBe(1);
    expect(result[0]!.subscriptionId).toBe("s2");
  });

  it("returns empty array when no subscriptions match window", () => {
    const window = { from: new Date("2030-01-01T00:00:00Z"), to: new Date("2030-01-31T23:59:59.999Z") };
    const result = filterByWindow(baseSubs, window, config);
    expect(result).toEqual([]);
  });

  it("includes boundary dates (start of window)", () => {
    const subs: SubscriptionItem[] = [
      { id: "edge", contactId: "c1", productId: "p1", amountMinor: 1000n, frequency: "monthly", status: "active", nextDueDate: "2025-04-01", consentGiven: true },
    ];
    const window = { from: new Date("2025-04-01T00:00:00Z"), to: new Date("2025-04-30T23:59:59.999Z") };
    const result = filterByWindow(subs, window, config);
    expect(result.length).toBe(1);
  });

  it("includes boundary dates (end of window)", () => {
    const subs: SubscriptionItem[] = [
      { id: "edge", contactId: "c1", productId: "p1", amountMinor: 1000n, frequency: "monthly", status: "active", nextDueDate: "2025-04-30", consentGiven: true },
    ];
    const window = { from: new Date("2025-04-01T00:00:00Z"), to: new Date("2025-04-30T23:59:59.999Z") };
    const result = filterByWindow(subs, window, config);
    expect(result.length).toBe(1);
  });

  it("preserves amountMinor as bigint in output", () => {
    const window = { from: new Date("2025-04-01T00:00:00Z"), to: new Date("2025-04-30T23:59:59.999Z") };
    const result = filterByWindow(baseSubs, window, config);
    for (const item of result) {
      expect(typeof item.amountMinor).toBe("bigint");
    }
  });
});

// ─── GROUP_BY_VALUES constant ─────────────────────────────────────────────────

describe("GROUP_BY_VALUES", () => {
  it("contains exactly product, region, owner", () => {
    expect(GROUP_BY_VALUES).toEqual(["product", "region", "owner"]);
  });

  it("has exactly 3 valid values", () => {
    expect(GROUP_BY_VALUES.length).toBe(3);
  });
});
