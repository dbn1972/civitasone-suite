import { describe, it, expect } from "vitest";
import { renderWithIntl } from "@/lib/testUtils/intl";
import ContactDetailLoading from "./loading";

describe("Contact detail loading skeleton (GAP-CRM-CONTACTS-DETAIL-06)", () => {
  it("mirrors the real two-column g-main layout (no single-column slate page)", () => {
    const { container } = renderWithIntl(<ContactDetailLoading />);
    // The loaded page uses `.grid.g-main`; the skeleton must too, so there is
    // no column shift when the content resolves.
    const grid = container.querySelector(".grid.g-main");
    expect(grid).not.toBeNull();
    // Two columns of card skeletons.
    expect(grid?.children.length).toBe(2);
    // It is marked busy for assistive tech.
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    // The old single-column slate background is gone.
    expect(container.querySelector(".min-h-screen")).toBeNull();
  });

  it("renders several card skeletons so panels don't pop in over blank space", () => {
    const { container } = renderWithIntl(<ContactDetailLoading />);
    expect(container.querySelectorAll(".card").length).toBeGreaterThanOrEqual(6);
  });
});
