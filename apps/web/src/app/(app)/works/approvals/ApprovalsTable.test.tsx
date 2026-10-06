import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";
import { ApprovalsTable } from "./ApprovalsTable";

const aa = [
  { id: "a1", workNumber: "3f9a1c20…", approvalNumber: "AA/1", date: "01 Jan 2026", authority: "aaaa…", amount: "100", type: "Original", status: "draft" },
  { id: "a2", workNumber: "4f9a1c20…", approvalNumber: "AA/2", date: "02 Jan 2026", authority: "bbbb…", amount: "200", type: "Original", status: "finalized" },
  { id: "a3", workNumber: "5f9a1c20…", approvalNumber: "AA/3", date: "03 Jan 2026", authority: "cccc…", amount: "300", type: "Revised", status: "submitted" },
];
const ts = [
  { id: "t1", workNumber: "9f9a1c20…", approvalNumber: "TS/1", date: "01 Jan 2026", authority: "dddd…", amount: "100", type: "Original", status: "draft" },
];

describe("ApprovalsTable", () => {
  it("renders an accessible tablist with two tabs and a labelled tabpanel (GAP-WORKS-APPROVALS-04)", () => {
    render(<ApprovalsTable aaApprovals={aa} tsApprovals={ts} source="api" />);
    const tablist = screen.getByRole("tablist", { name: "Approval type" });
    const tabs = within(tablist).getAllByRole("tab");
    expect(tabs).toHaveLength(2);
    expect(tabs[0]).toHaveAttribute("aria-selected", "true");
    const panel = screen.getByRole("tabpanel");
    expect(panel).toHaveAttribute("aria-labelledby");
  });

  it("counts Pending as draft-only, matching the backend finalize rule (GAP-WORKS-APPROVALS-02)", () => {
    render(<ApprovalsTable aaApprovals={aa} tsApprovals={ts} source="api" />);
    // 3 AA total, only 1 is draft -> Pending AA = 1 (NOT 2: 'submitted' is not pending).
    expect(screen.getByText("Total AA").closest("*")?.parentElement?.textContent).toContain("3");
    const pendingAa = screen.getByText("Pending AA").closest("div")?.parentElement;
    expect(pendingAa?.textContent).toMatch(/1/);
  });

  it("labels the opaque work/authority columns as IDs rather than as a number/name (GAP-WORKS-APPROVALS-01)", () => {
    render(<ApprovalsTable aaApprovals={aa} tsApprovals={ts} source="api" />);
    expect(screen.getByText("Work (ID)")).toBeInTheDocument();
    expect(screen.getByText("Authority (ID)")).toBeInTheDocument();
  });

  it("switches to the TS register when the second tab is activated", () => {
    render(<ApprovalsTable aaApprovals={aa} tsApprovals={ts} source="api" />);
    fireEvent.click(screen.getByRole("tab", { name: "TS Register" }));
    expect(screen.getByText("TS/1")).toBeInTheDocument();
  });
});
