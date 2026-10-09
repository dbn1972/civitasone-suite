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

describe("ApprovalsTable — GAP2-WORKS-APPROVALS-05 true total + truncation notice", () => {
  const aa100 = Array.from({ length: 100 }, (_v, i) => ({
    id: `a${i}`, workNumber: `w${i}`, approvalNumber: `AA/${i}`, date: "01 Jan 2026",
    authority: "x", amount: "100", type: "Original", status: "draft",
  }));

  it("Total AA shows the TRUE tenant count (101), not the capped page length (100)", () => {
    render(<ApprovalsTable aaApprovals={aa100} tsApprovals={ts} source="api" aaTotal={101} tsTotal={1} />);
    const totalAa = screen.getByText("Total AA").closest("div")?.parentElement;
    expect(totalAa?.textContent).toContain("101");
  });

  it("shows a 'first 100 of 101' notice when the AA register is truncated", () => {
    render(<ApprovalsTable aaApprovals={aa100} tsApprovals={ts} source="api" aaTotal={101} tsTotal={1} />);
    expect(screen.getByText(/showing the first 100 of 101/i)).toBeInTheDocument();
  });

  it("labels the pending card as '(shown)' when truncated (count is over the page only)", () => {
    render(<ApprovalsTable aaApprovals={aa100} tsApprovals={ts} source="api" aaTotal={101} tsTotal={1} />);
    expect(screen.getByText(/Pending AA \(shown\)/i)).toBeInTheDocument();
  });

  it("no truncation notice when the page holds the whole set (rows == total)", () => {
    render(<ApprovalsTable aaApprovals={aa} tsApprovals={ts} source="api" aaTotal={aa.length} tsTotal={ts.length} />);
    expect(screen.queryByText(/showing the first/i)).not.toBeInTheDocument();
  });
});
