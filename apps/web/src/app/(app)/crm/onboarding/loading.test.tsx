import { describe, it, expect } from "vitest";
import { renderWithIntl } from "@/lib/testUtils/intl";
import OnboardingLoading from "./loading";

/**
 * GAP-CRM-ONBOARDING-04: the loading state is now a filter + table-row
 * skeleton (ds Skeleton theme tokens), not a bare "Loading onboarding cases…"
 * text line.
 */
describe("GAP-CRM-ONBOARDING-04 onboarding loading skeleton", () => {
  it("renders a skeleton (not a bare text line) using theme tokens", () => {
    const { container } = renderWithIntl(<OnboardingLoading />);
    expect(container.querySelector('[aria-busy="true"]')).not.toBeNull();
    expect(container.innerHTML).toContain("var(--line2)");
    expect(container.textContent).not.toContain("Loading onboarding cases…");
  });
});
