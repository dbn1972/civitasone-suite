import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: () => Promise.resolve({ data: [], source: "api" }),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

import GstConsolePage from "./page";
import GstLoading from "./loading";

// GAP-FINANCE-GST-07: the loading skeleton must mirror the page, or the content shifts when it arrives. The page renders
// six stat cards in a 4-column grid (two rows); a skeleton with four left the second row to pop in.
describe("GST loading skeleton mirrors the page", () => {
  it("shows exactly as many stat cards as the page renders", async () => {
    const { container: pageDom, unmount } = render(await GstConsolePage({ searchParams: Promise.resolve({ period: "2026-06" }) }));
    const pageStatCards = pageDom.querySelectorAll(".stat").length;
    unmount();

    const { container: skeletonDom } = render(<GstLoading />);
    const skeletonCards = skeletonDom.querySelectorAll(".grid.g-4 > div").length;

    expect(pageStatCards).toBe(6);
    expect(skeletonCards).toBe(pageStatCards);
  });

  it("is a labelled, polite status region with the period card ahead of the stat grid", () => {
    const { container } = render(<GstLoading />);
    const root = screen.getByRole("status", { name: "Loading GST console" });
    expect(root).toHaveAttribute("aria-live", "polite");
    const blocks = Array.from(container.querySelectorAll(".card, .grid.g-4"));
    expect(blocks[0]!.className).toContain("card");
    expect(blocks[1]!.className).toContain("g-4");
  });
});
