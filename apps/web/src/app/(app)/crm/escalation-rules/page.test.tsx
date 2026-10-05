import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

// The editor pulls data on mount; stub it so this test only checks the header.
vi.mock("../../../_components/crm/EscalationRulesEditor", () => ({
  EscalationRulesEditor: () => null,
}));

import Page from "./page";

/**
 * GAP-CRM-ESCALATION-RULES-07: the page is titled "Lead Escalation Rules" (not
 * the ambiguous "Escalation Rules" that collides with /crm/task-escalation) and
 * cross-links to the task-escalation route.
 */
describe("GAP-CRM-ESCALATION-RULES-07 lead-escalation page header", () => {
  it("titles the page 'Lead Escalation Rules' and links to Task Escalation", () => {
    render(<Page />);
    expect(screen.getByRole("heading", { name: "Lead Escalation Rules" })).toBeInTheDocument();
    const link = screen.getByRole("link", { name: /Task Escalation/i });
    expect(link).toHaveAttribute("href", "/crm/task-escalation");
  });
});
