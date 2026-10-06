import { describe, it, expect } from "vitest";
import { renderWithIntl } from "@/lib/testUtils/intl";
import Loading from "./loading";

describe("Documents loading skeleton (GAP-CRM-DOCUMENTS-04)", () => {
  it("renders card skeletons, not a four-tile stat grid", () => {
    const { container } = renderWithIntl(<Loading />);
    // No 80px stat tiles flashing before the real cards.
    expect(container.querySelector('[style*="height: 80px"]')).toBeNull();
    // At least one card skeleton + the subtitle placeholder (matches PageHeader).
    expect(container.querySelectorAll(".card").length).toBeGreaterThanOrEqual(1);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.querySelector("#page-heading")?.textContent).toBe("Documents");
  });
});
