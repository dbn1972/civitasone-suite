/**
 * payments/queries.ts — Issue #6 regression tests.
 *
 * Root cause: `@civitasone/cache`'s serialize() JSON.stringify()s whatever it
 * caches, and the global `BigInt.prototype.toJSON` patch
 * (shared/bigint-json.ts) turns every bigint `*Minor` field into a plain
 * decimal STRING before it is written to the store — but deserialize() is a
 * bare `JSON.parse` with no reviver to turn it back. listBillSummaries(),
 * getBillDetail() and listAdvances() all read the raw row through
 * `cache.getOrLoad` and only THEN do bigint arithmetic/formatting on its
 * `*Minor` fields, so a cache HIT (row shape with string `*Minor` fields,
 * simulated directly below) previously crashed with "Cannot mix BigInt and
 * other types, use explicit conversions". This was invisible before
 * procurement-service went live only because the bills/advances lists being
 * exercised were empty arrays — `[].map()` never once invokes the
 * vulnerable callback, cache-hit or not.
 */
import { describe, it, expect } from "vitest";
import { vi } from "vitest";

// Shared mutable state between the (hoisted) cache mock below and each
// test's setRow() call. Declared via vi.hoisted() because Vitest hoists
// vi.mock() factories above ordinary top-level code, so a factory can only
// safely close over bindings created the same way.
const mockCache = vi.hoisted(() => ({ current: undefined as unknown }));

vi.mock("../src/shared/infra.js", () => ({
  cache: {
    // Bypasses the real cache/loader entirely. Whatever a test sets via
    // setRow() is returned as-is — this exactly simulates what
    // @civitasone/cache hands back after a real cache HIT (string `*Minor`
    // fields, once bigint has round-tripped through JSON) or a cache MISS
    // (genuine bigint `*Minor` fields straight from Drizzle), depending only
    // on which JS type the test puts into the row.
    getOrLoad: vi.fn(async () => mockCache.current),
    listOrLoad: vi.fn(async () => mockCache.current),
    makeKey: (...parts: string[]) => parts.join(":"),
  },
}));

import { listBillSummaries, listAdvances, getBillDetail, listUCs, toMinorBigInt } from "../src/modules/payments/queries.js";
import { UCSummaryListSchema } from "@civitasone/schemas/web";

function setRow(v: unknown): void {
  mockCache.current = v;
}

describe("toMinorBigInt (pure coercion helper)", () => {
  it("passes through a genuine bigint unchanged", () => {
    expect(toMinorBigInt(175000n)).toBe(175000n);
  });

  it("coerces a decimal string (the post-cache-hit shape) to bigint", () => {
    expect(toMinorBigInt("175000")).toBe(175000n);
  });

  it("coerces a plain number to bigint", () => {
    expect(toMinorBigInt(175000)).toBe(175000n);
  });

  it("preserves full precision for values beyond Number.MAX_SAFE_INTEGER", () => {
    expect(toMinorBigInt("123456789012345678")).toBe(123456789012345678n);
  });
});

describe("listBillSummaries — cache-hit shape (netMinor as a string) does not crash", () => {
  it("formats correctly when netMinor arrives as a string, exactly as a cache HIT returns it", async () => {
    setRow([
      {
        id: "bill-1",
        billNo: "BILL-001",
        vendorId: "eeeeeeee-0001-0000-0000-000000000001",
        netMinor: "175000", // string: what @civitasone/cache hands back post round-trip
        createdAt: "2026-04-01T00:00:00.000Z",
        status: "pending",
        poRef: null,
      },
    ]);
    const result = await listBillSummaries("tenant-1", 10, 0);
    expect(result).toHaveLength(1);
    expect(result[0].amount).toBe("175000");
    expect(result[0].amountDisplay).toBe("₹1,750.00");
  });

  it("still formats correctly on a cache MISS (netMinor is a genuine bigint)", async () => {
    setRow([
      {
        id: "bill-2",
        billNo: "BILL-002",
        vendorId: "eeeeeeee-0001-0000-0000-000000000002",
        netMinor: 4200000n, // bigint: fresh from Drizzle's mode:"bigint" column
        createdAt: "2026-04-01T00:00:00.000Z",
        status: "paid",
        poRef: "PO-1",
      },
    ]);
    const result = await listBillSummaries("tenant-1", 10, 0);
    expect(result[0].amount).toBe("4200000");
    expect(result[0].amountDisplay).toBe("₹42,000.00");
  });

  it("does not throw when the tenant has zero real bills (the state that masked this bug pre-procurement)", async () => {
    setRow([]);
    await expect(listBillSummaries("tenant-1", 10, 0)).resolves.toEqual([]);
  });
});

describe("getBillDetail — cache-hit shape (netMinor as a string) does not crash", () => {
  it("formats correctly and resolves three-way-match when netMinor arrives as a string", async () => {
    setRow({
      id: "bill-1",
      tenantId: "tenant-1",
      billNo: "BILL-001",
      vendorId: "eeeeeeee-0001-0000-0000-000000000003",
      netMinor: "980000", // string: post-cache-hit shape
      createdAt: "2026-04-01T00:00:00.000Z",
      status: "paid",
      poRef: "PO-1",
      grnRef: "GRN-1",
    });
    const result = await getBillDetail("bill-1", "tenant-1");
    expect(result?.amount).toBe("980000");
    expect(result?.amountDisplay).toBe("₹9,800.00");
    expect(result?.threeWayMatch).toBe("matched");
  });
});

describe("listAdvances — balance subtraction stays exact across the cache round-trip", () => {
  it("computes an exact bigint balance when both *Minor fields arrive as strings", async () => {
    setRow([
      {
        id: "adv-1",
        advanceNo: "ADV-001",
        beneficiary: "Test Employee",
        type: "employee",
        // Beyond Number.MAX_SAFE_INTEGER (9007199254740991) — the exact
        // class of value the "H3" string-amount convention exists to
        // protect. A naive `row.amountMinor - row.adjustedMinor` on two
        // STRINGS (the pre-fix behaviour once cached) coerces via Number and
        // can silently drift for values this large; toMinorBigInt() keeps
        // the subtraction exact.
        amountMinor: "10000000000000000",
        adjustedMinor: "1",
        disbursedDate: "2026-04-01",
        dueDate: null,
        status: "active",
      },
    ]);
    const result = await listAdvances("tenant-1", 10, 0);
    expect(result[0].amount).toBe("10000000000000000");
    expect(result[0].adjustedAmount).toBe("1");
    expect(result[0].balance).toBe("9999999999999999");
  });
});

describe("listUCs — amount round-trips as a bigint-safe string through UCSummaryListSchema", () => {
  it("returns amount as a string, and UCSummaryListSchema accepts it, even beyond 2^53", async () => {
    setRow([
      {
        id: "uc-1",
        ucNo: "UC-001",
        grantRef: "NHM-2024",
        grantee: "NHM-2024",
        // Beyond Number.MAX_SAFE_INTEGER (9007199254740991) — the exact class
        // of value the "H3" string-amount convention exists to protect, and
        // the exact class of value UCSummarySchema's old `amount: z.number()`
        // would 400 on as a string, or silently corrupt as a number.
        amountMinor: "123456789012345",
        periodFrom: "2025-04-01",
        periodTo: "2026-03-31",
        submittedDate: "2026-04-05",
        status: "submitted",
      },
    ]);
    const result = await listUCs("tenant-1", 10);
    expect(result[0].amount).toBe("123456789012345");
    // BUG FIX regression: UCSummarySchema.amount used to be z.number(), which
    // rejects this string outright ("Expected number, received string") —
    // the exact live failure GET /v1/finance/utilization-certificates 400'd
    // on for every tenant with >=1 UC record. Must not throw, and must
    // preserve full precision (no round-trip through Number, which would
    // silently corrupt anything beyond 2^53 instead of throwing).
    const parsed = UCSummaryListSchema.parse(result);
    expect(parsed[0].amount).toBe("123456789012345");
  });
});
