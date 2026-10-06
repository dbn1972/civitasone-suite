import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import Page from "./page";

describe("Catalogue hub page", () => {
  // GAP-CATALOGUE-HOME-01 / RATES-02 (COPY): tiles must describe what the
  // destination pages actually show (read-only lists), not promise variants,
  // pricing or pricing rules that no screen delivers.
  it("tile copy promises only what the pages deliver", () => {
    render(<Page />);
    const body = document.body.textContent ?? "";
    expect(body).not.toMatch(/variants/i);
    expect(body).not.toMatch(/pricing rules/i);
    expect(screen.getByText("Browse the products and services list.")).toBeInTheDocument();
    expect(screen.getByText("Browse effective-dated rate cards.")).toBeInTheDocument();
    expect(screen.getByText("Browse the product category hierarchy.")).toBeInTheDocument();
    expect(screen.getByText("Browse product bundles and combo offerings.")).toBeInTheDocument();
  });

  // GAP-CATALOGUE-HOME-05 (BACKEND): no help article with slug "catalogue"
  // exists (helpContent.ts HELP_MODULES), so /help/catalogue would 404. The
  // help prop is removed rather than linking to a dead page.
  it("renders no help link (would be a dead /help/catalogue 404)", () => {
    render(<Page />);
    const helpLink = screen.queryByRole("link", { name: /how this works/i });
    expect(helpLink).toBeNull();
    const anyCatalogueHelp = Array.from(document.querySelectorAll("a")).find(
      (a) => a.getAttribute("href") === "/help/catalogue",
    );
    expect(anyCatalogueHelp).toBeUndefined();
  });

  // GAP-CATALOGUE-HOME-04 (ICONS): each of the four tiles resolves to a
  // distinct vector icon (StatIcon svg), not the generic 📁 folder fallback.
  it("renders a vector icon (not raw emoji) for each of the four tiles", () => {
    const { container } = render(<Page />);
    const iconBoxes = Array.from(container.querySelectorAll(".ic"));
    expect(iconBoxes).toHaveLength(4);
    for (const box of iconBoxes) {
      expect(box.querySelector("svg")).toBeInTheDocument();
      expect(box.textContent).toBe("");
    }
  });
});
