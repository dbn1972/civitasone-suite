import { describe, it, expect } from "vitest";
import { buildShortlistRequest, rowProblem, toRows } from "./reservationShortlist";

const c = (id: string, category: string | null, label = id) => ({ id, label, category });

describe("reservation shortlist request", () => {
  it("normalises aliases and sends numeric scores", () => {
    const rows = toRows([c("a", "SC"), c("b", "General"), c("c", "obc-ncl")], { a: "82.5", b: "91", c: "70" });
    expect(rows.map((r) => r.normalised)).toEqual(["SC", "UR", "OBC"]);
    expect(buildShortlistRequest(rows)).toEqual({ ok: true, body: { candidates: [
      { applicationId: "a", category: "SC", score: 82.5 },
      { applicationId: "b", category: "UR", score: 91 },
      { applicationId: "c", category: "OBC", score: 70 },
    ] } });
  });

  it("FAILS CLOSED on a missing or unrecognised category -- never silently UR", () => {
    const rows = toRows([c("a", null), c("b", "PH"), c("c", "ST")], { a: "1", b: "2", c: "3" });
    expect(rowProblem(rows[0]!)).toBe("no_category");
    expect(rowProblem(rows[1]!)).toBe("unmapped_category");
    const r = buildShortlistRequest(rows);
    expect(r).toEqual({ ok: false, problems: [{ id: "a", problem: "no_category" }, { id: "b", problem: "unmapped_category" }] });
  });

  it("needs a numeric, non-negative score for every row", () => {
    const rows = toRows([c("a", "SC"), c("b", "SC"), c("c", "SC")], { b: "x", c: "-3" });
    expect(rows.map(rowProblem)).toEqual(["no_score", "bad_score", "bad_score"]);
  });

  it("an empty pool is not a request", () => {
    expect(buildShortlistRequest([])).toEqual({ ok: false, problems: [] });
  });
});
