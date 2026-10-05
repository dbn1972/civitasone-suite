import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { StatusPill } from "../../../_components/ds/StatusPill";

/**
 * GAP-CRM-GRIEVANCES-06 pinning test. The CPGRAMS grievance register renders
 * each row's status through the shared StatusPill. Before this gap, two of the
 * five CPGRAMS states (FORWARDED, APPEAL) had no entry in STATUS_MAP and fell
 * back to the neutral "info" pill, so the register's colour carried no meaning
 * for those rows. These assertions pin the chosen tone for every CPGRAMS state
 * and fail on the old (unmapped) code.
 */
function pillTone(status: string): string | null {
  const { container } = render(<StatusPill status={status} />);
  const el = container.querySelector(".pill");
  const tone = el ? [...el.classList].find((c) => c !== "pill") : undefined;
  return tone ?? null;
}

describe("GAP-CRM-GRIEVANCES-06 CPGRAMS status tones", () => {
  it.each([
    ["REGISTERED", "warn"],
    ["FORWARDED", "warn"],
    ["ATTENDED", "info"],
    ["DISPOSED", "mut"],
    ["APPEAL", "bad"],
  ])("renders %s with the %s tone (not the neutral info fallback)", (status, tone) => {
    expect(pillTone(status)).toBe(tone);
  });

  it("humanizes the raw enum so clerks never see uppercase enum text", () => {
    const { getByText } = render(<StatusPill status="APPEAL" />);
    // humanizeStatus turns "APPEAL" into "Appeal", not raw uppercase.
    expect(getByText("Appeal")).toBeInTheDocument();
  });
});
