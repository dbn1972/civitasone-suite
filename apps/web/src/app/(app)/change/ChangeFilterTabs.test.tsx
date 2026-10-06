import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { ChangeFilterTabs } from "./ChangeFilterTabs";

/**
 * GAP-CHANGE-HOME-03: the CAB queue must be a discoverable status filter, not
 * just a count. The tabs are anchor links (?status=…) so the page stays a
 * Server Component.
 */
describe("ChangeFilterTabs (GAP-CHANGE-HOME-03)", () => {
  const counts = { all: 12, submitted: 3, scheduled: 2, open: 7 };

  it("marks the active tab with aria-selected and renders counts", () => {
    render(<ChangeFilterTabs active="submitted" counts={counts} />);
    const awaiting = screen.getByRole("tab", { name: /Awaiting CAB \(3\)/ });
    expect(awaiting).toHaveAttribute("aria-selected", "true");
    expect(awaiting).toHaveAttribute("aria-current", "page");
    expect(screen.getByRole("tab", { name: /All \(12\)/ })).toHaveAttribute("aria-selected", "false");
  });

  it("links 'Awaiting CAB' to ?status=submitted and 'All' to /change", () => {
    render(<ChangeFilterTabs active="all" counts={counts} />);
    expect(screen.getByRole("tab", { name: /Awaiting CAB/ })).toHaveAttribute("href", "/change?status=submitted");
    expect(screen.getByRole("tab", { name: /All/ })).toHaveAttribute("href", "/change");
  });
});
