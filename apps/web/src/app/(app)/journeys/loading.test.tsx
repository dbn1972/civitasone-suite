import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import HubLoading from "./loading";
import ActiveLoading from "./active/loading";

// GAP-JOURNEYS-HOME-04: the hub skeleton is a tile-hub shape; the table-shaped
// sub-pages carry a table skeleton. They must differ.
describe("journeys loading skeletons", () => {
  it("hub loading renders a tile-hub skeleton (loading busy region, no full-height table block)", () => {
    const { container } = render(<HubLoading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    // the old hub skeleton used an h-96 full-table block + min-h-screen wrapper
    expect(container.querySelector(".h-96")).toBeNull();
    expect(container.querySelector(".min-h-screen")).toBeNull();
  });

  it("active (table) loading renders a table skeleton (aria-busy data region)", () => {
    const { container } = render(<ActiveLoading />);
    const region = container.querySelector('[aria-busy="true"]');
    expect(region).not.toBeNull();
    expect(region?.getAttribute("aria-label")).toMatch(/loading data/i);
  });
});
