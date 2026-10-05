import { describe, it, expect } from "vitest";
import { renderWithIntl } from "@/lib/testUtils/intl";
import NewGrievanceLoading from "./loading";

/**
 * GAP-CRM-GRIEVANCES-NEW-06: the skeleton must match the loaded form (a 640px
 * card, not the register's full-width table block) and use theme tokens. The
 * old skeleton was byte-identical to the list skeleton (max-w-7xl, slate-200,
 * h-80 block) — these assertions fail on it.
 */
describe("GAP-CRM-GRIEVANCES-NEW-06 new-grievance loading skeleton", () => {
  it("renders a 640px-max form card skeleton, not a full-width table block", () => {
    const { container } = renderWithIntl(<NewGrievanceLoading />);
    const card = container.querySelector('[aria-busy="true"]') as HTMLElement | null;
    expect(card).not.toBeNull();
    expect(card?.style.maxWidth).toBe("640px");
  });

  it("uses ds Skeleton theme tokens, not hard-coded slate-200 / max-w-7xl", () => {
    const { container } = renderWithIntl(<NewGrievanceLoading />);
    expect(container.innerHTML).not.toContain("slate-200");
    expect(container.innerHTML).not.toContain("max-w-7xl");
    expect(container.innerHTML).toContain("var(--line2)");
  });
});
