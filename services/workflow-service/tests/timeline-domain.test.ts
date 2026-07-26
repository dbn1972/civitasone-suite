/** CAP-037 — unified timeline pure domain: deterministic chronological merge. */
import { describe, it, expect } from "vitest";
import { mergeTimeline, type TimelineEntry } from "../src/modules/timeline/domain.js";

function e(id: string, at: string, source: TimelineEntry["source"] = "comment"): TimelineEntry {
  return { source, id, at, actorId: null, action: "x", summary: "", detail: {} };
}

describe("mergeTimeline", () => {
  it("orders newest first across sources", () => {
    const merged = mergeTimeline(
      [e("a", "2026-01-01T00:00:00Z")],
      [e("b", "2026-03-01T00:00:00Z", "transition")],
      [e("c", "2026-02-01T00:00:00Z", "deviation")],
    );
    expect(merged.map((x) => x.id)).toEqual(["b", "c", "a"]);
  });
  it("breaks ties deterministically by (source, id)", () => {
    const same = "2026-01-01T00:00:00Z";
    const merged = mergeTimeline([e("z", same, "comment")], [e("a", same, "closure")]);
    // closure < comment alphabetically -> closure first
    expect(merged.map((x) => x.source)).toEqual(["closure", "comment"]);
  });
  it("returns an empty stream for no inputs", () => {
    expect(mergeTimeline()).toEqual([]);
  });
});
