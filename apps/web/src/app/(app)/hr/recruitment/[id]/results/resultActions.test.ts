import { describe, it, expect } from "vitest";
import { attemptsForVacancy, resultActions, type AttemptRow } from "./resultActions";

const at = (over: Partial<AttemptRow>): AttemptRow => ({ id: "x", applicationId: "a1", status: "evaluated", result: "pass", slotLabel: null, frozen: false, published: false, ...over });

describe("resultActions", () => {
  it("evaluated -> consolidate or freeze; frozen -> publish; published -> nothing", () => {
    expect(resultActions(at({}))).toEqual(["consolidate", "freeze"]);
    expect(resultActions(at({ frozen: true }))).toEqual(["publish"]);
    expect(resultActions(at({ frozen: true, published: true }))).toEqual([]);
    expect(resultActions(at({ status: "in_progress" }))).toEqual([]);
  });
});

describe("attemptsForVacancy", () => {
  it("keeps only this vacancy's applicants (by application id), sorted by name", () => {
    const names = new Map([["a1", "Zoya"], ["a2", "Asha"]]);
    const out = attemptsForVacancy([at({ id: "1", applicationId: "a1" }), at({ id: "2", applicationId: "a2" }), at({ id: "3", applicationId: "other" }), at({ id: "4", applicationId: null })], names);
    expect(out.map((o) => [o.id, o.name])).toEqual([["2", "Asha"], ["1", "Zoya"]]);
  });
});
