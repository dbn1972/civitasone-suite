import { describe, it, expect } from "vitest";
import { renderWithIntl } from "@/lib/testUtils/intl";
import LeadEscalationRulesLoading from "./loading";

/**
 * GAP-CRM-ESCALATION-RULES-06/07: the skeleton has no stat tiles (the page has
 * none), uses ds Skeleton theme tokens (no #f1f5f9 blocks), and its title
 * matches the page's new "Lead Escalation Rules" heading.
 */
describe("GAP-CRM-ESCALATION-RULES-06/07 loading skeleton", () => {
  it("titles the skeleton 'Lead Escalation Rules' and renders no stat tiles", () => {
    const { container } = renderWithIntl(<LeadEscalationRulesLoading />);
    expect(container.querySelector("#page-heading")?.textContent).toBe("Lead Escalation Rules");
    // No four-tile grid: the old skeleton used a repeat() tile grid with fixed
    // 80px blocks; the new one is a card + rows only.
    expect(container.innerHTML).not.toContain("#f1f5f9");
    expect(container.innerHTML).toContain("var(--line2)");
  });
});
