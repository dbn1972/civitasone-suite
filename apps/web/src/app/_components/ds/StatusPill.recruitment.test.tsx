import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusPill } from "./StatusPill";

// GAP-RECRUITMENT-DETAIL-07: the recruitment detail page prints these as pills (raw snake_case before).
// Kept in its own file so appends to StatusPill.test.tsx by other batches never conflict with it.
describe("StatusPill recruitment statuses (GAP-RECRUITMENT-DETAIL-07)", () => {
  const pill = (status: string) => render(<StatusPill status={status} />).container.querySelector(".pill") as HTMLElement;

  it.each([
    ["manual_review", "Manual Review", "warn"],
    ["on_hold", "On Hold", "warn"],
    ["shortlisted", "Shortlisted", "info"],
    ["eligible", "Eligible", "good"],
    ["ineligible", "Ineligible", "bad"],
    ["withdrawn", "Withdrawn", "mut"],
    ["open", "Open", "good"],
    ["closed", "Closed", "mut"],
  ])("renders %s as %j with the %s tone", (status, label, tone) => {
    const el = pill(status);
    expect(el.textContent).toBe(label);
    expect(el.classList.contains(tone)).toBe(true);
  });
});
