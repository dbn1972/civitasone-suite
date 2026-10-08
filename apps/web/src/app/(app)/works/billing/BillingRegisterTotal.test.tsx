import { describe, it, expect, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";

/**
 * GAP2-WORKS-APPROVALS-05 (billing register): when the result is LIVE, the
 * "Total Bills" card must show the TRUE tenant count from the register meta
 * (the `total` prop), not the capped page length, and a "first N of M" notice
 * must appear when the page is truncated. Mocks a LIVE resource of 100 rows.
 */
const LIVE_ROWS = Array.from({ length: 100 }, (_v, i) => ({
  id: `b${i}`, billNo: `RA-${i}`, work: "W/1", mode: "e-MB",
  gross: "100000", netPayable: "90000", stage: "Draft", status: "draft", rawStatus: "draft",
}));

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: () => ({ data: LIVE_ROWS, provenance: "live", offline: false, cachedAt: null }),
}));

import { BillingRegister } from "./BillingTable";

function statValue(label: string): string {
  const labelEl = screen.getAllByText(label).find((el) => el.className === "lab");
  if (!labelEl) throw new Error(`no stat card labelled "${label}"`);
  const card = labelEl.parentElement!;
  return within(card).getByText(/^\d+$/).textContent ?? "";
}

describe("BillingRegister — GAP2-WORKS-APPROVALS-05 true total (live)", () => {
  it("Total Bills shows the TRUE tenant count (133), not the capped page length (100)", () => {
    render(<BillingRegister bills={[]} source="api" total={133} />);
    expect(statValue("Total Bills")).toBe("133");
  });

  it("shows a 'first 100 of 133' truncation notice", () => {
    render(<BillingRegister bills={[]} source="api" total={133} />);
    expect(screen.getByText(/showing the first 100 of 133/i)).toBeInTheDocument();
  });

  it("labels the bucket cards as '(shown)' when truncated", () => {
    render(<BillingRegister bills={[]} source="api" total={133} />);
    expect(screen.getByText(/Draft \(shown\)/i)).toBeInTheDocument();
  });

  it("no truncation notice when the page holds the whole set (rows == total)", () => {
    render(<BillingRegister bills={[]} source="api" total={100} />);
    expect(screen.queryByText(/showing the first/i)).not.toBeInTheDocument();
  });
});
