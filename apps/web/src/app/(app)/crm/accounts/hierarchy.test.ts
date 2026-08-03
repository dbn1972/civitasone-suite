import { describe, it, expect } from "vitest";
import type { CRMAccountSummary } from "@civitasone/types";
import { buildAccountTree, countSubsidiaries } from "./hierarchy";

function account(id: string, name: string, parentId: string | null = null): CRMAccountSummary {
  return { id, name, industry: null, website: null, parentId, contactCount: 0 };
}

describe("buildAccountTree", () => {
  it("nests children under their parent with increasing depth", () => {
    const rows = buildAccountTree([
      account("a", "Head Office"),
      account("b", "Regional Office", "a"),
      account("c", "Branch", "b"),
    ]);

    expect(rows.map((r) => [r.id, r.depth])).toEqual([
      ["a", 0],
      ["b", 1],
      ["c", 2],
    ]);
  });

  it("keeps siblings in the order supplied by the API", () => {
    const rows = buildAccountTree([
      account("root", "Root"),
      account("x", "Alpha", "root"),
      account("y", "Beta", "root"),
    ]);

    expect(rows.map((r) => r.id)).toEqual(["root", "x", "y"]);
  });

  it("treats an account whose parent is absent from the page as a root", () => {
    const rows = buildAccountTree([account("orphan", "Orphan", "not-on-this-page")]);

    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ id: "orphan", depth: 0 });
  });

  it("does not drop or loop on accounts that form a cycle", () => {
    const rows = buildAccountTree([account("p", "P", "q"), account("q", "Q", "p")]);

    expect(rows.map((r) => r.id).sort()).toEqual(["p", "q"]);
    expect(rows.every((r) => r.depth === 0)).toBe(true);
  });

  it("returns an empty list for no accounts", () => {
    expect(buildAccountTree([])).toEqual([]);
  });
});

describe("countSubsidiaries", () => {
  it("counts only accounts whose parent is on the page", () => {
    const accounts = [
      account("a", "Head Office"),
      account("b", "Regional", "a"),
      account("c", "Detached", "missing"),
    ];

    expect(countSubsidiaries(accounts)).toBe(1);
  });
});
