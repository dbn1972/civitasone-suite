import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusPill } from "@/app/_components/ds/StatusPill";

// GAP-FINANCE-REVENUE-CHALLANS-04 / DETAIL-05
describe("StatusPill challan states", () => {
  it("renders verified as a success pill, not the neutral fallback", () => {
    const { container } = render(<StatusPill status="verified" />);
    expect(container.querySelector("span")?.className).toBe("pill good");
  });
  it("renders reconciled good and deposited as an explicit neutral step", () => {
    expect(render(<StatusPill status="reconciled" />).container.querySelector("span")?.className).toBe("pill good");
    expect(render(<StatusPill status="deposited" />).container.querySelector("span")?.className).toBe("pill info");
  });
});
