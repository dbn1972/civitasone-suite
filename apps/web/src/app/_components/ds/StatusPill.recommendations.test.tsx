import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusPill } from "./StatusPill";

/**
 * GAP-RECOMMENDATIONS-HEALTH-01/03 and FEEDBACK-03: health bands and
 * accept/reject feedback must render as colour-coded pills, not neutral info
 * (which made a critical account look like a thriving one, and accepted look
 * like rejected).
 */
describe("StatusPill recommendation tones", () => {
  const tone = (status: string) => {
    const { container } = render(<StatusPill status={status} />);
    return container.querySelector(".pill")?.className ?? "";
  };

  it("critical health band is 'bad'", () => {
    expect(tone("critical")).toContain("bad");
  });

  it("at_risk health band is 'bad' (normalized from snake_case)", () => {
    expect(tone("at_risk")).toContain("bad");
  });

  it("thriving health band is 'good'", () => {
    expect(tone("thriving")).toContain("good");
  });

  it("healthy health band is 'good'", () => {
    expect(tone("healthy")).toContain("good");
  });

  it("accepted feedback is 'good' and rejected is 'bad' (distinct colours)", () => {
    expect(tone("accepted")).toContain("good");
    expect(tone("rejected")).toContain("bad");
  });
});
