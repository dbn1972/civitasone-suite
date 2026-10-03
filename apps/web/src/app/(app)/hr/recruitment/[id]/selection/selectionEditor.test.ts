import { describe, it, expect } from "vitest";
import { approvalBlock, autoRank, buildEntries, type EditorRow } from "./selectionEditor";

const row = (id: string, category: EditorRow["category"], rank = "", score = "", name = id): EditorRow => ({ applicationId: id, name, category, rank, score });

describe("buildEntries", () => {
  it("builds ranked entries and ignores rows that are not on the list", () => {
    const r = buildEntries([row("a", "selected", "1", "90"), row("b", "selected", "2"), row("c", "waitlist", "1", "70.5"), row("d", "none")], 2);
    expect(r).toEqual({ ok: true, entries: [
      { applicationId: "a", candidateName: "a", category: "selected", rank: 1, score: 90 },
      { applicationId: "b", candidateName: "b", category: "selected", rank: 2 },
      { applicationId: "c", candidateName: "c", category: "waitlist", rank: 1, score: 70.5 },
    ] });
  });
  it("rejects empty lists, bad ranks, gaps, too many selected and bad scores", () => {
    expect(buildEntries([row("a", "none")], 2)).toEqual({ ok: false, error: "no_entries" });
    expect(buildEntries([row("a", "selected", "")], 2)).toEqual({ ok: false, error: "rank_invalid" });
    expect(buildEntries([row("a", "selected", "0")], 2)).toEqual({ ok: false, error: "rank_invalid" });
    expect(buildEntries([row("a", "selected", "1.5")], 2)).toEqual({ ok: false, error: "rank_invalid" });
    expect(buildEntries([row("a", "selected", "1"), row("b", "selected", "3")], 5)).toEqual({ ok: false, error: "rank_not_contiguous" });
    expect(buildEntries([row("a", "selected", "1"), row("b", "selected", "1")], 5)).toEqual({ ok: false, error: "rank_not_contiguous" });
    expect(buildEntries([row("a", "selected", "1"), row("b", "selected", "2")], 1)).toEqual({ ok: false, error: "too_many_selected" });
    expect(buildEntries([row("a", "selected", "1", "abc")], 1)).toEqual({ ok: false, error: "score_invalid" });
  });
  it("selected and waitlist rank independently from 1", () => {
    expect(buildEntries([row("a", "selected", "1"), row("b", "waitlist", "1")], 1).ok).toBe(true);
  });
});

describe("autoRank", () => {
  it("ranks by score descending within each category; blank scores last", () => {
    const out = autoRank([row("a", "selected", "", "70"), row("b", "selected", "", "90"), row("c", "selected", "", ""), row("d", "waitlist", "", "10"), row("e", "none")]);
    expect(Object.fromEntries(out.map((r) => [r.applicationId, r.rank]))).toEqual({ a: "2", b: "1", c: "3", d: "1", e: "" });
  });
});

describe("approvalBlock (maker-checker hint; the service is the authority)", () => {
  it("blocks the list's creator and whoever set its ranking", () => {
    expect(approvalBlock({ createdBy: "u1", entriesSetBy: "u2" }, "u1")).toBe("maker");
    expect(approvalBlock({ createdBy: "u1", entriesSetBy: "u2" }, "u2")).toBe("maker");
    expect(approvalBlock({ createdBy: "u1", entriesSetBy: null }, "u3")).toBeNull();
    expect(approvalBlock({ createdBy: "u1", entriesSetBy: null }, null)).toBeNull();
  });
});
