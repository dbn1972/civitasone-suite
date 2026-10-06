import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusPill } from "./StatusPill";

// GAP-REPORTS-LIST-05: report-service job lifecycle is
// queued | running | completed | failed. "running" previously had no entry and
// fell through to the neutral "info" default (visually identical to an unknown
// status). Kept in its own file so other batches' appends to StatusPill.test.tsx
// never conflict with it.
describe("StatusPill report-job statuses (GAP-REPORTS-LIST-05)", () => {
  const pill = (status: string) => render(<StatusPill status={status} />).container.querySelector(".pill") as HTMLElement;

  it.each([
    ["queued", "mut"],
    ["running", "warn"],
    ["completed", "good"],
    ["failed", "bad"],
  ])("renders %s with the %s tone (running is not the default info)", (status, tone) => {
    const el = pill(status);
    expect(el.classList.contains(tone)).toBe(true);
  });

  it("running is specifically NOT the neutral info default", () => {
    expect(pill("running").classList.contains("info")).toBe(false);
  });
});
