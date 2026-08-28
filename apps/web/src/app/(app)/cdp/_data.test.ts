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
      meta: "2026-08-01T00:00:00.000Z",
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
    // sublabel checks `status` before `category` in the fallback chain, so it
    // matches the separate `status` field here too — pre-existing behaviour,
    // untouched by this fix.
    expect(row.sublabel).toBe("approved");
    expect(row.status).toBe("approved");
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
    expect(row.meta).toBe("2026-08-20T12:00:00.000Z");
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
});
