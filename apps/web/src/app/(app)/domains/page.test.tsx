import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import DomainsPage from "./page";

// GAP-DOMAINS-NEW-01: the /domains index must exist (post-save routed here and
// 404'd before). It is an honest landing page — no fabricated domain list.
describe("DomainsPage (GAP-DOMAINS-NEW-01)", () => {
  it("renders and links to the registration form", () => {
    render(<DomainsPage />);
    expect(screen.getByRole("heading", { name: "Domains" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Register New Domain/i });
    expect(link).toHaveAttribute("href", "/domains/new");
  });

  it("does not fabricate a domain registry listing", () => {
    render(<DomainsPage />);
    expect(screen.getByText(/registry listing view is not available/i)).toBeInTheDocument();
  });
});
