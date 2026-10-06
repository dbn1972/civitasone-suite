import { describe, it, expect } from "vitest";
import type { CRMAccountSummary } from "@civitasone/types";
import { buildAccountTree, buildNestedAccountTree, countSubsidiaries, collectDescendantIds } from "./hierarchy";

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

describe("buildNestedAccountTree (GAP-CRM-ACCOUNTS-06)", () => {
  it("nests children arrays under their parent node", () => {
    const roots = buildNestedAccountTree([
      account("a", "Head Office"),
      account("b", "Regional Office", "a"),
      account("c", "Branch", "b"),
    ]);
    expect(roots).toHaveLength(1);
    expect(roots[0]!.id).toBe("a");
    expect(roots[0]!.children.map((n) => n.id)).toEqual(["b"]);
    expect(roots[0]!.children[0]!.children.map((n) => n.id)).toEqual(["c"]);
  });

  it("treats an account whose parent is absent as a root", () => {
    const roots = buildNestedAccountTree([account("orphan", "Orphan", "missing")]);
    expect(roots.map((n) => n.id)).toEqual(["orphan"]);
    expect(roots[0]!.children).toEqual([]);
  });

  it("is cycle-safe and drops nothing", () => {
    const roots = buildNestedAccountTree([account("p", "P", "q"), account("q", "Q", "p")]);
    const ids = roots.map((n) => n.id).sort();
    expect(ids).toEqual(["p", "q"]);
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

describe("collectDescendantIds (GAP-CRM-ACCOUNTS-DETAIL-03)", () => {
  const accounts = [
    account("a", "Head Office"),
    account("b", "Regional", "a"),
    account("c", "Branch", "b"),
    account("d", "Other Top"),
  ];

  it("returns the full subtree, excluding the root itself", () => {
    const d = collectDescendantIds(accounts, "a");
    expect(d.has("b")).toBe(true);
    expect(d.has("c")).toBe(true);
    expect(d.has("a")).toBe(false);
    expect(d.has("d")).toBe(false);
    expect(d.size).toBe(2);
  });

  it("returns an empty set for a leaf", () => {
    expect(collectDescendantIds(accounts, "c").size).toBe(0);
  });

  it("is cycle-safe", () => {
    const cyclic = [account("x", "X", "y"), account("y", "Y", "x")];
    // Should terminate and not throw.
    expect(() => collectDescendantIds(cyclic, "x")).not.toThrow();
  });
});
