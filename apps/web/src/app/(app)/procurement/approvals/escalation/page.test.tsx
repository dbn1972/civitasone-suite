import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import EscalationRulesPage from "./page";

describe("EscalationRulesPage (GAP-PROCUREMENT-APPROVALS-ESCALATION-02/03/04)", () => {
  it("GAP-ESCALATION-03: links to the pending approvals queue it governs", () => {
    render(<EscalationRulesPage />);
    const links = screen.getAllByRole("link", { name: /pending approvals|Back to Approvals/i });
    const hrefs = links.map((l) => l.getAttribute("href"));
    expect(hrefs).toContain("/procurement/approvals");
    expect(screen.getByRole("link", { name: "View pending approvals" })).toBeInTheDocument();
  });

  it("GAP-ESCALATION-03: names the working-day calendar in a footnote", () => {
    render(<EscalationRulesPage />);
    const note = screen.getByRole("note");
    expect(note).toHaveTextContent(/Holiday Calendar/i);
    expect(note).toHaveTextContent(/working days/i);
  });

  it("GAP-ESCALATION-04: the SoD list uses classes, not an inline style attribute", () => {
    const { container } = render(<EscalationRulesPage />);
    const ul = container.querySelector("ul");
    expect(ul).not.toBeNull();
    expect(ul!.getAttribute("style")).toBeNull();
    expect(ul!.className).toContain("list-disc");
  });

  it("GAP-ESCALATION-02: renders non-overlapping band labels", () => {
    render(<EscalationRulesPage />);
    // First band reads "... and below"; the next two read "Over ...".
    expect(screen.getByText(/and below$/)).toBeInTheDocument();
    const overs = screen.getAllByText(/^Over /);
    expect(overs.length).toBeGreaterThanOrEqual(2);
  });
});
