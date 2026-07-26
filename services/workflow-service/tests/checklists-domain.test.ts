/** CAP-036 — checklist gating engine pure domain. */
import { describe, it, expect } from "vitest";
import { instantiate, evaluateGate, toggleItem, validateTemplate } from "../src/modules/checklists/domain.js";

const tpl = [
  { key: "id_check", label: "ID verified", required: true },
  { key: "fee_paid", label: "Fee paid", required: true },
  { key: "note", label: "Optional note", required: false },
];

describe("instantiate + evaluateGate", () => {
  it("a fresh checklist gate is closed while required items are unchecked", () => {
    const items = instantiate(tpl);
    const g = evaluateGate(items);
    expect(g.open).toBe(false);
    expect(g.totalRequired).toBe(2);
    expect(g.blockingKeys).toEqual(["id_check", "fee_paid"]);
  });
  it("gate opens once every required item is checked (optional need not be)", () => {
    let items = instantiate(tpl);
    items = toggleItem(items, "id_check", true, "u1", "2026-01-01T00:00:00Z").items;
    items = toggleItem(items, "fee_paid", true, "u1", "2026-01-01T00:00:00Z").items;
    const g = evaluateGate(items);
    expect(g.open).toBe(true);
    expect(g.requiredCompleted).toBe(2);
  });
});

describe("toggleItem", () => {
  it("records who/when on check and clears on uncheck; reports not-found", () => {
    const items = instantiate(tpl);
    const checked = toggleItem(items, "id_check", true, "u9", "2026-05-05T00:00:00Z");
    expect(checked.found).toBe(true);
    expect(checked.items.find((i) => i.key === "id_check")!.checkedBy).toBe("u9");
    const un = toggleItem(checked.items, "id_check", false, "u9", "2026-05-05T00:00:00Z");
    expect(un.items.find((i) => i.key === "id_check")!.checkedBy).toBeNull();
    expect(toggleItem(items, "missing", true, "u9", "t").found).toBe(false);
  });
});

describe("validateTemplate", () => {
  it("rejects empty and duplicate keys", () => {
    expect(validateTemplate([]).errors).toContain("NO_ITEMS");
    expect(validateTemplate([{ key: "a", label: "A" }, { key: "a", label: "B" }]).errors).toContain("DUPLICATE_KEY");
  });
  it("accepts a clean template", () => {
    expect(validateTemplate([{ key: "a", label: "A" }]).allowed).toBe(true);
  });
});
