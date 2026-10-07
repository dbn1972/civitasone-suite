import { describe, it, expect } from "vitest";
import { mapRows } from "./_data";

describe("mapRows", () => {
  it("labels a segment-shaped row from its name, description and status", () => {
    const [row] = mapRows([
      { id: "seg-1", name: "High value donors", description: "Top decile lifetime value", status: "active", updatedAt: "2026-08-01T00:00:00.000Z" },
    ]);

    expect(row).toMatchObject({
      id: "seg-1",
      label: "High value donors",
      sublabel: "Top decile lifetime value",
      status: "active",
      // GAP-CDP-SEGMENTS-04: updatedAt is now formatted in IST, not raw ISO.
      meta: "01 Aug 2026, 05:30 am",
    });
  });

  it("labels an event-taxonomy row from eventName, not the raw id", () => {
    // services/cdp-service taxonomy-repo.ts#toView has no `name` field — only
    // `eventName`. Before this fix the label fallback chain didn't know about
    // it and every row on /cdp/events showed its own UUID as the "name".
    const [row] = mapRows([
      { id: "9c1f2b3a-0000-4000-8000-000000000001", eventName: "order_placed", category: "behavioural", status: "approved", updatedAt: "2026-08-01T00:00:00.000Z" },
    ]);

    expect(row.label).toBe("order_placed");
    expect(row.label).not.toBe("9c1f2b3a-0000-4000-8000-000000000001");
    // GAP-CDP-EVENTS-04: `status` is no longer part of the sublabel chain, so it
    // is NOT duplicated into Detail — the sublabel now falls to `category`.
    expect(row.sublabel).toBe("behavioural");
    expect(row.status).toBe("approved");
    // GAP-CDP-EVENTS-01: updatedAt is formatted in IST, not shown as raw ISO.
    expect(row.meta).toBe("01 Aug 2026, 05:30 am");
  });

  it("labels an anonymous-visitor row from visitorRef and shows lastSeenAt as meta", () => {
    // identity/visitor-repo.ts#toView has neither `name` nor `updatedAt` — it
    // has `visitorRef` (a short, presentable stand-in for the internal id)
    // and `lastSeenAt`. Before this fix both fell through to "—"/raw id.
    const [row] = mapRows([
      {
        id: "3fa1c111-0000-4000-8000-000000000002",
        visitorRef: "a1b2c3d4e5f6",
        status: "anonymous",
        deviceType: "web",
        lastSeenAt: "2026-08-20T12:00:00.000Z",
      },
    ]);

    expect(row.label).toBe("a1b2c3d4e5f6");
    // GAP-CDP-IDENTITY-03: lastSeenAt is formatted in IST, not raw ISO.
    expect(row.meta).toBe("20 Aug 2026, 05:30 pm");
  });

  it("falls back to the row id when nothing else identifies it", () => {
    const [row] = mapRows([{ id: "row-only-id" }]);
    expect(row.label).toBe("row-only-id");
    expect(row.sublabel).toBeUndefined();
    expect(row.meta).toBeUndefined();
  });

  it("unwraps a { data: [...] } envelope the same way", () => {
    const rows = mapRows({ data: [{ id: "seg-1", name: "Segment One" }] });
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "seg-1", label: "Segment One" });
  });

  it("returns an empty list for a payload with no recognizable rows", () => {
    expect(mapRows(null)).toEqual([]);
    expect(mapRows({})).toEqual([{ id: "row-1", label: "row-1" }]);
  });

  it("does not repeat the status in Detail when a row has only name + status (GAP-CDP-EVENTS-04)", () => {
    const [row] = mapRows([{ id: "x", name: "A", status: "ACTIVE" }]);
    expect(row.status).toBe("ACTIVE");
    // sublabel (Detail column) must be absent, not a second copy of the status.
    expect(row.sublabel).toBeUndefined();
  });

  it("keeps a non-date meta field (code) verbatim, only dates are reformatted (GAP-CDP-EVENTS-01)", () => {
    const [row] = mapRows([{ id: "c1", name: "Coupon", code: "SAVE20" }]);
    expect(row.meta).toBe("SAVE20");
  });

  it("passes an unparseable date meta through unchanged rather than 'Invalid Date' (GAP-CDP-IDENTITY-03)", () => {
    const [row] = mapRows([{ id: "d1", name: "Odd", updatedAt: "not-a-date" }]);
    expect(row.meta).toBe("not-a-date");
  });
});
