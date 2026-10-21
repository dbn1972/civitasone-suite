import { describe, it, expect } from "vitest";
import { latestNoteOf, noteExcerpt } from "./latestNote";

describe("latestNoteOf (GAP-ESTAB-APPROVALS-03)", () => {
  it("picks the newest note by timestamp whatever the listed order", () => {
    const note = latestNoteOf([
      { content: "newest", author: "B", timestamp: "2026-10-03T10:00:00.000Z" },
      { content: "oldest", author: "A", timestamp: "2026-10-01T10:00:00.000Z" },
      { content: "middle", author: "C", timestamp: "2026-10-02T10:00:00.000Z" },
    ]);
    expect(note).toEqual({ content: "newest", author: "B", at: "2026-10-03T10:00:00.000Z" });
  });

  it("skips notes with no text and returns undefined when there is nothing to show", () => {
    expect(latestNoteOf([{ content: "   " }, { content: 7 }, {}])).toBeUndefined();
    expect(latestNoteOf([])).toBeUndefined();
    expect(latestNoteOf(undefined)).toBeUndefined();
    expect(latestNoteOf(null)).toBeUndefined();
  });

  it("falls back to the last listed note when no timestamp parses, and keeps an unresolved author as null", () => {
    const note = latestNoteOf([
      { content: "first", author: "A", timestamp: "not a date" },
      { content: "second", author: null },
    ]);
    expect(note).toEqual({ content: "second", author: null, at: null });
  });

  it("prefers a dated note over an undated one", () => {
    const note = latestNoteOf([
      { content: "dated", timestamp: "2026-10-01T00:00:00.000Z" },
      { content: "undated" },
    ]);
    expect(note?.content).toBe("dated");
  });
});

describe("noteExcerpt", () => {
  it("collapses whitespace and leaves a short note whole", () => {
    expect(noteExcerpt("  Please\n\n  sanction \t now ", 100)).toBe("Please sanction now");
  });

  it("cuts a long note to the limit with an ellipsis", () => {
    const out = noteExcerpt("word ".repeat(100), 20);
    expect(out.length).toBeLessThanOrEqual(20);
    expect(out.endsWith("…")).toBe(true);
  });

  it("does not add an ellipsis at exactly the limit", () => {
    expect(noteExcerpt("abcde", 5)).toBe("abcde");
  });
});
