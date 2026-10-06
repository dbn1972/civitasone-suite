import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({ usePathname: () => "/" }));

import { Sidebar } from "./Sidebar";

// GAP-DOCUMENTS-HOME-02: Documents was reachable only by URL — it now has a
// moduleKey-gated nav entry.
describe("Sidebar — Documents entry", () => {
  it("shows Documents when the tenant has the module enabled", () => {
    render(<Sidebar enabledModules={["documents"]} />);
    const link = screen.getByRole("link", { name: /Documents/ });
    expect(link).toHaveAttribute("href", "/documents");
  });

  it("hides Documents when the tenant does not have the module", () => {
    render(<Sidebar enabledModules={["crm"]} />);
    expect(screen.queryByRole("link", { name: /Documents/ })).not.toBeInTheDocument();
  });
});
