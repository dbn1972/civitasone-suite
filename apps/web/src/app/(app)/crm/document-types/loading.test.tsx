import { describe, it, expect } from "vitest";
import { renderWithIntl } from "@/lib/testUtils/intl";
import Loading from "./loading";

describe("Document Types loading skeleton (GAP-CRM-DOCUMENT-TYPES-05)", () => {
  it("renders a card of stacked row blocks, not a tile grid", () => {
    const { container } = renderWithIntl(<Loading />);
    // No 80px stat tiles.
    expect(container.querySelector('[style*="height: 80px"]')).toBeNull();
    // One card skeleton with stacked ~180px row blocks.
    expect(container.querySelector(".card")).not.toBeNull();
    const rowBlocks = container.querySelectorAll('[style*="height: 180px"]');
    expect(rowBlocks.length).toBeGreaterThanOrEqual(3);
    // aria-busy for assistive tech and the heading matches the loaded page.
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector("#page-heading")?.textContent).toBe("Document Types");
  });
});
