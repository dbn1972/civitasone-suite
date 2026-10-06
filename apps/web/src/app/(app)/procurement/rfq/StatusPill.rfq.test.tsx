import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusPill } from "../../../_components/ds";

/**
 * GAP-PROCUREMENT-RFQ-04: pin the RFQ status enum -> pill tone mapping so the
 * list/detail pages never render an RFQ status with the neutral "info"
 * fallthrough (which would be visually meaningless) or raw lowercase text.
 */
describe("StatusPill — RFQ status tones (GAP-PROCUREMENT-RFQ-04)", () => {
  function tone(status: string): string {
    const { container } = render(<StatusPill status={status} />);
    return container.querySelector("span.pill")!.className;
  }

  it("'issued' is a neutral in-progress info tone (not an unmapped fallthrough)", () => {
    expect(tone("issued")).toContain("info");
  });

  it("'awarded' is the successful terminal 'good' tone", () => {
    expect(tone("awarded")).toContain("good");
  });

  it("'closed' is a muted terminal tone", () => {
    expect(tone("closed")).toContain("mut");
  });

  it("renders a humanized label, never the raw lowercase enum value", () => {
    const { container } = render(<StatusPill status="awarded" />);
    expect(container.querySelector("span.pill")!.textContent).toBe("Awarded");
  });
});
