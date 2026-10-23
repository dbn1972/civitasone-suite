import { describe, it, expect } from "vitest";
import { render, screen, fireEvent, within } from "@/test-utils/intl-render";
import { ApprovalsTable, buildApprovalColumns } from "./ApprovalsTable";

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

  it("labels the work/authority columns as a number/name now that works-service joins them (GAP-WORKS-APPROVALS-01)", () => {
    render(<ApprovalsTable aaApprovals={aa} tsApprovals={ts} source="api" />);
    expect(screen.getByText("Work Number")).toBeInTheDocument();
    expect(screen.getByText("Authority")).toBeInTheDocument();
    expect(screen.queryByText("Work (ID)")).not.toBeInTheDocument();
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

describe("ApprovalsTable stat cards follow the rows on screen (GAP-WORKS-APPROVALS-03) and rows open their detail (TS-DETAIL-01)", () => {
  const rows = [
    { id: "a1", workNumber: "W1", approvalNumber: "AA/1", date: "01 Jan 2026", authority: "X", amount: "100", type: "Original", status: "draft" },
    { id: "a2", workNumber: "W2", approvalNumber: "AA/2", date: "02 Jan 2026", authority: "X", amount: "100", type: "Original", status: "finalized" },
  ];

  it("with an error source but cached/seeded rows, Total AA equals the rows shown (not a false 0)", () => {
    render(<ApprovalsTable aaApprovals={rows} tsApprovals={[]} source="error" />);
    const total = screen.getByText("Total AA").closest("*")?.parentElement?.textContent ?? "";
    expect(total).toContain("2");
  });

  it("with an error source and no rows at all, the cards show an em dash, never 0", () => {
    render(<ApprovalsTable aaApprovals={[]} tsApprovals={[]} source="error" />);
    const total = screen.getByText("Total AA").closest("*")?.parentElement?.textContent ?? "";
    expect(total).toContain("—");
    expect(total).not.toMatch(/\b0\b/);
  });

  it("each AA row links to its by-id detail page, so a record beyond the first list page is still reachable", () => {
    render(<ApprovalsTable aaApprovals={rows} tsApprovals={[]} source="api" />);
    const hrefs = screen.getAllByRole("link").map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/works/approvals/aa/a1");
  });
});

// GAP-WORKS-APPROVALS-01: readable work number / authority, a link to the work, and labelled ID fallbacks.
describe("ApprovalsTable — work number and authority cells (GAP-WORKS-APPROVALS-01)", () => {
  const WORK_ID = "3f9a1c20-1111-4111-8111-111111111111";
  const OFFICER_ID = "aaaa1111-2222-4222-8222-222222222222";
  const resolved = {
    id: "a1", workId: WORK_ID, authorityId: OFFICER_ID, workNumber: "WK/2026/001", workNumberResolved: true,
    approvalNumber: "AA/1", date: "01 Jan 2026", authority: "Anita Rao", authorityResolved: true,
    amount: "100", type: "Original", status: "draft",
  };
  const unresolved = {
    id: "a2", workId: WORK_ID, authorityId: OFFICER_ID, workNumber: "3f9a1c20…", workNumberResolved: false,
    approvalNumber: "AA/2", date: "02 Jan 2026", authority: "aaaa1111…", authorityResolved: false,
    amount: "200", type: "Original", status: "draft",
  };

  it("shows the real work number and officer name, with the work number linking to the work", () => {
    render(<ApprovalsTable aaApprovals={[resolved]} tsApprovals={[]} source="api" />);
    const workLink = screen.getByRole("link", { name: "WK/2026/001" });
    expect(workLink).toHaveAttribute("href", `/works/proposals/${WORK_ID}`);
    expect(screen.getByText("Anita Rao")).toBeInTheDocument();
    expect(screen.queryByText(/^ID /)).not.toBeInTheDocument();
    expect(screen.queryByText(/Unknown officer/)).not.toBeInTheDocument();
  });

  it("labels an unresolved work as an ID and an unresolved officer as 'Unknown officer', each with the FULL id as a tooltip", () => {
    render(<ApprovalsTable aaApprovals={[unresolved]} tsApprovals={[]} source="api" />);
    const workLink = screen.getByRole("link", { name: "ID 3f9a1c20…" });
    expect(workLink).toHaveAttribute("title", WORK_ID);
    expect(workLink).toHaveAttribute("href", `/works/proposals/${WORK_ID}`);
    expect(screen.getByText("Unknown officer (aaaa1111…)")).toHaveAttribute("title", OFFICER_ID);
    // never a bare hash standing in for a number or a name
    expect(screen.queryByText("3f9a1c20…")).not.toBeInTheDocument();
    expect(screen.queryByText("aaaa1111…")).not.toBeInTheDocument();
  });

  it("the approval number is the row link to the detail page, so the work number can be its own link", () => {
    render(<ApprovalsTable aaApprovals={[resolved]} tsApprovals={[]} source="api" />);
    const headers = screen.getAllByRole("columnheader").map((h) => h.textContent ?? "");
    expect(headers[0]).toContain("Approval Number");
    const detail = screen.getByRole("link", { name: "Open AA/1" });
    expect(detail).toHaveAttribute("href", "/works/approvals/aa/a1");
    // no link nested inside another link
    expect(detail.querySelector("a")).toBeNull();
  });

  it("the CSV carries the readable values, and the FULL ids for rows that could not be resolved", () => {
    const [approval, work, , authority] = buildApprovalColumns((k, v) => `${k}:${v.id}`);
    expect(approval!.key).toBe("approvalNumber");
    expect(work!.csv!(resolved)).toBe("WK/2026/001");
    expect(authority!.csv!(resolved)).toBe("Anita Rao");
    expect(work!.csv!(unresolved)).toBe(WORK_ID);
    expect(authority!.csv!(unresolved)).toBe(OFFICER_ID);
  });

  it("rows without the resolution flags (older callers) are treated as resolved", () => {
    const [, work, , authority] = buildApprovalColumns((k, v) => `${k}:${v.id}`);
    const legacy = { id: "x", workNumber: "W1", authority: "X" };
    expect(work!.csv!(legacy)).toBe("W1");
    expect(authority!.render!(legacy)).toBe("X");
  });
});
