import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { LinkTiles } from "./LinkTiles";

describe("LinkTiles", () => {
  const tiles = [
    { title: "Dashboard", href: "/dashboard", description: "Overview stats" },
    { title: "Employees", href: "/hr/employees", description: "Manage staff" },
    { title: "Payments", href: "/finance/payments" },
  ];

  it("renders all tiles as links", () => {
    render(<LinkTiles tiles={tiles} />);
    expect(screen.getByRole("link", { name: /Dashboard/ })).toHaveAttribute("href", "/dashboard");
    expect(screen.getByRole("link", { name: /Employees/ })).toHaveAttribute("href", "/hr/employees");
    expect(screen.getByRole("link", { name: /Payments/ })).toHaveAttribute("href", "/finance/payments");
  });

  it("renders tile titles", () => {
    render(<LinkTiles tiles={tiles} />);
    expect(screen.getByText("Dashboard")).toBeInTheDocument();
    expect(screen.getByText("Employees")).toBeInTheDocument();
    expect(screen.getByText("Payments")).toBeInTheDocument();
  });

  it("renders tile descriptions when provided", () => {
    render(<LinkTiles tiles={tiles} />);
    expect(screen.getByText("Overview stats")).toBeInTheDocument();
    expect(screen.getByText("Manage staff")).toBeInTheDocument();
  });

  it("does not render description when not provided", () => {
    render(<LinkTiles tiles={[{ title: "Test", href: "/test" }]} />);
    const links = screen.getAllByRole("link");
    expect(links).toHaveLength(1);
    expect(links[0].querySelector(".l")).not.toBeInTheDocument();
  });

  it("applies three-column grid by default", () => {
    const { container } = render(<LinkTiles tiles={tiles} />);
    expect(container.querySelector(".grid.g-3")).toBeInTheDocument();
  });

  it("applies four-column grid when columns='four'", () => {
    const { container } = render(<LinkTiles tiles={tiles} columns="four" />);
    expect(container.querySelector(".grid.g-4")).toBeInTheDocument();
  });

  it("renders the tile icon mapped from TILE_ICONS as a real vector icon", () => {
    // Bug B: "📊" is in StatIcon's map, so the icon box must render the
    // <svg> lucide-react icon it resolves to -- not the literal emoji
    // character, which renders as an empty "tofu" box in any environment
    // without an OS color-emoji font (e.g. this repo's own
    // scripts/dev/capture-screenshots.mjs host). Confirmed live: Workflow's
    // "My tasks / Instances / Definitions / BPMN Designer" tiles, which go
    // through this same TILE_ICONS map, showed empty squares pre-fix.
    const { container } = render(<LinkTiles tiles={[{ title: "Dashboard", href: "/d" }]} />);
    const icon = container.querySelector(".ic") as HTMLElement;
    expect(icon.querySelector("svg")).toBeInTheDocument();
    expect(icon.textContent).toBe("");
  });

  it("falls back to the raw glyph for a resolved icon with no vector mapping", () => {
    // "Indents" -> "📑" (page facing up), not yet in StatIcon's map -- not a
    // regression, this is exactly today's pre-fix behavior for the long
    // tail not yet covered.
    const { container } = render(<LinkTiles tiles={[{ title: "Indents", href: "/i" }]} />);
    const icon = container.querySelector(".ic") as HTMLElement;
    expect(icon.querySelector("svg")).not.toBeInTheDocument();
    expect(icon.textContent).toBe("📑");
  });

  // GAP-BILLING-HOME-03: the billing hub tiles had no TILE_ICONS entry and no
  // matching href substring, so all rendered the generic 📁 folder glyph
  // (FolderOpen svg). Each now maps to a distinct, StatIcon-vectorised icon.
  // These assertions fail on the old map (where billing titles resolved to 📁).
  describe("billing hub tile icons (GAP-BILLING-HOME-03)", () => {
    it.each(["Plans", "Subscriptions", "Invoices", "GSTN Console"])(
      "renders a vector (non-folder) icon for the %s tile",
      (title) => {
        const { container } = render(<LinkTiles tiles={[{ title, href: `/billing/${title}` }]} />);
        const icon = container.querySelector(".ic") as HTMLElement;
        // A mapped glyph resolves to an <svg> and empties the text box; the
        // old 📁 fallback also renders FolderOpen, so additionally assert the
        // billing tiles do NOT share the Payments/unknown fallback by checking
        // each resolves to its own svg.
        expect(icon.querySelector("svg")).toBeInTheDocument();
        expect(icon.textContent).toBe("");
      },
    );

    it("an unknown billing-ish title still falls through to the generic folder glyph", () => {
      const { container } = render(<LinkTiles tiles={[{ title: "Some Unknown Tile", href: "/billing/x" }]} />);
      const icon = container.querySelector(".ic") as HTMLElement;
      // 📁 -> FolderOpen svg (the generic fallback), text emptied.
      expect(icon.querySelector("svg")).toBeInTheDocument();
      expect(icon.textContent).toBe("");
    });
  });

  // GAP-FIELD-HOME-01: the Field hub's five tiles matched no title key and no
  // href heuristic, so all rendered the generic 📁 folder glyph. Each now maps
  // to its own vector icon — these fail on the old TILE_ICONS map.
  describe("field hub tile icons (GAP-FIELD-HOME-01)", () => {
    it.each([
      ["Tasks", "/field/tasks"],
      ["Visits", "/field/visits"],
      ["Routes", "/field/routes"],
      ["Agents", "/field/agents"],
      ["Offline Sync", "/field/sync"],
    ])("renders a vector (non-folder) icon for the %s tile", (title, href) => {
      const { container } = render(<LinkTiles tiles={[{ title, href }]} />);
      const icon = container.querySelector(".ic") as HTMLElement;
      expect(icon.querySelector("svg")).toBeInTheDocument();
      expect(icon.textContent).toBe("");
    });
  });

  it("applies the auto-fit grid when columns='auto' (GAP-FIELD-HOME-02)", () => {
    const { container } = render(<LinkTiles tiles={tiles} columns="auto" />);
    expect(container.querySelector(".grid.g-auto")).toBeInTheDocument();
  });
});

// GAP-AI-HOME-01: the AI hub's five tiles (Chat/Copilot/Agents/Guardrails/
// Governance) previously all fell through to the 📁 FolderOpen default,
// giving the hub no visual cue between them. They must now each resolve to a
// distinct vector icon (never the shared folder default).
describe("LinkTiles — AI hub icons (GAP-AI-HOME-01)", () => {
  const aiTiles = [
    { title: "Chat", href: "/ai/chat" },
    { title: "Copilot", href: "/ai/copilot" },
    { title: "Agents", href: "/ai/agents" },
    { title: "Guardrails", href: "/ai/guardrails" },
    { title: "Governance", href: "/ai/governance" },
  ];

  it("renders a distinct vector icon for each AI tile (not the 📁 fallback)", () => {
    const { container } = render(<LinkTiles tiles={aiTiles} />);
    const iconBoxes = Array.from(container.querySelectorAll<HTMLElement>(".ic"));
    expect(iconBoxes).toHaveLength(5);
    // Each AI tile resolves to a lucide <svg>, never the raw-emoji text or the
    // folder fallback.
    const classes = new Set<string>();
    for (const box of iconBoxes) {
      const svg = box.querySelector("svg");
      expect(svg).toBeInTheDocument();
      // No raw emoji text leaked through (would mean a missing StatIcon map).
      expect(box.textContent).toBe("");
      const cls = svg?.getAttribute("class") ?? "";
      classes.add(cls);
    }
    // All five icon classes are distinct — no two tiles share a glyph, and
    // none is the FolderOpen default.
    expect(classes.size).toBe(5);
    expect([...classes].some((c) => /folder/i.test(c))).toBe(false);
  });
});
