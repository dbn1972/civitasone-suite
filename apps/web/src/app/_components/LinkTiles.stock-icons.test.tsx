import { describe, it, expect, vi } from "vitest";
import { render } from "@testing-library/react";
import { LinkTiles } from "./LinkTiles";

vi.mock("next/link", () => ({
  default: ({ href, children, className, style }: { href: string; children: React.ReactNode; className?: string; style?: React.CSSProperties }) => (
    <a href={href} className={className} style={style}>{children}</a>
  ),
}));

// GAP-STOCK-HOME-04: the stock hub tiles must resolve to distinct icons, not
// the generic 📁 folder fallback (which StatIcon renders as lucide
// "folder-open"). TILE_ICONS now maps Stock List -> 📦 (package) and
// Stock Ledger -> 📒 (book-marked), so neither tile should render folder-open.
describe("LinkTiles — stock hub icons (GAP-STOCK-HOME-04)", () => {
  it("Stock List and Stock Ledger resolve to distinct, non-folder icons", () => {
    const { container } = render(
      <LinkTiles
        tiles={[
          { title: "Stock List", href: "/stock/list" },
          { title: "Stock Ledger", href: "/stock/ledger" },
        ]}
      />,
    );
    const svgClasses = Array.from(container.querySelectorAll("svg")).map((s) => s.getAttribute("class") ?? "");
    // No tile fell back to the folder-open (📁) default.
    expect(svgClasses.some((c) => c.includes("folder-open"))).toBe(false);
    // Package (📦) and book-marked (📒) are present and distinct.
    expect(svgClasses.some((c) => c.includes("package"))).toBe(true);
    expect(svgClasses.some((c) => c.includes("book-marked"))).toBe(true);
  });
});
