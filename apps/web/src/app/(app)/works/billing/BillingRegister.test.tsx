import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * GAP-WORKS-BILLING-03: the stat cards must be computed from the SAME
 * useSeededResource `data` as the table — so when the live result is empty but
 * a cache exists, the cards reflect the cached rows actually shown (not 0).
 * This mock returns cached rows regardless of the passed-in (empty) seed.
 */
const CACHED = [
  { id: "b1", billNo: "RA-01", work: "W/1", mode: "e-MB", gross: "100000", netPayable: "90000", stage: "Draft", status: "draft", rawStatus: "draft" },
  { id: "b2", billNo: "RA-02", work: "W/1", mode: "e-MB", gross: "100000", netPayable: "90000", stage: "So finalized", status: "pending", rawStatus: "so_finalized" },
  { id: "b3", billNo: "RA-03", work: "W/2", mode: "Abstract", gross: "100000", netPayable: "90000", stage: "Do finalized", status: "finalized", rawStatus: "do_finalized" },
  { id: "b4", billNo: "RA-04", work: "W/2", mode: "e-MB", gross: "100000", netPayable: "90000", stage: "Submitted", status: "submitted_ifms", rawStatus: "submitted" },
];

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: () => ({
    data: CACHED,
    provenance: "cached",
    offline: true,
    cachedAt: Date.now(),
  }),
}));

import { BillingRegister } from "./BillingTable";

/** Read a StatCard's numeric value by its label: the ds StatCard renders
 * sibling `.lab` (label) and `.val` (value) divs inside one card. */
function statValue(label: string): string {
  const labelEl = screen.getAllByText(label).find((el) => el.className === "lab");
  if (!labelEl) throw new Error(`no stat card labelled "${label}"`);
  const card = labelEl.parentElement!;
  return within(card).getByText(/^\d+$/).textContent ?? "";
}

describe("BillingRegister stat cards (GAP-WORKS-BILLING-01 / 03)", () => {
  it("counts drafts under a dedicated Draft card and pending separately (GAP-01)", () => {
    // Pass an EMPTY live seed; the mocked resource swaps in 4 cached rows.
    render(<BillingRegister bills={[]} source="api" />);
    expect(statValue("Total Bills")).toBe("4");
    expect(statValue("Draft")).toBe("1");
    expect(statValue("Pending")).toBe("1");
    expect(statValue("Finalized")).toBe("1");
    expect(statValue("Submitted to IFMS")).toBe("1");
  });

  it("stat total equals the row count even though the live seed was empty (GAP-03)", () => {
    render(<BillingRegister bills={[]} source="api" />);
    // 4 cached rows render in the table despite the empty seed.
    expect(screen.getByText("RA-01")).toBeInTheDocument();
    expect(screen.getByText("RA-04")).toBeInTheDocument();
    expect(statValue("Total Bills")).toBe("4");
  });
});
