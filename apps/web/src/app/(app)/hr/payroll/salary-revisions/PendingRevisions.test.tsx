import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { PendingRevisions, type PendingRevision } from "./PendingRevisions";

const ROW: PendingRevision = {
  id: "00000000-0000-4000-8000-0000000000a1",
  employeeLabel: "Asha Rao (EMP-1)",
  effectiveDate: "2026-04-01",
  typeLabel: "Annual Increment",
  oldBasic: "₹40,000.00",
  newBasic: "₹44,000.00",
  orderNo: "ORD-1",
};

function renderList(rows: PendingRevision[] = [ROW]) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PendingRevisions rows={rows} />
    </NextIntlClientProvider>,
  );
}

describe("PendingRevisions (GAP-PAYROLL-SALARY-REVISIONS-04)", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("renders nothing when there is nothing to decide", () => {
    renderList([]);
    expect(screen.queryByText("Salary revisions awaiting approval")).not.toBeInTheDocument();
  });

  it("approves via PATCH /salary-revisions/:id/approve", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "Approve the salary revision for Asha Rao (EMP-1)" }));
    await screen.findByText("Approve this salary revision?");
    const buttons = screen.getAllByRole("button", { name: "Approve" });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    const [url, init] = fetchMock.mock.calls[0]!;
    expect(String(url)).toContain(`v1/payroll/salary-revisions/${ROW.id}/approve`);
    expect((init as RequestInit).method).toBe("PATCH");
    await waitFor(() => expect(screen.getByText("Revision for Asha Rao (EMP-1) approved.")).toBeInTheDocument());
    expect(refreshMock).toHaveBeenCalled();
  });

  it("rejecting needs a reason of at least 10 characters", async () => {
    fetchMock.mockResolvedValue(new Response("{}", { status: 202 }));
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "Reject the salary revision for Asha Rao (EMP-1)" }));
    await screen.findByText("Reject this salary revision?");
    const rejectBtn = () => { const b = screen.getAllByRole("button", { name: "Reject" }); return b[b.length - 1] as HTMLButtonElement; };
    fireEvent.change(screen.getByLabelText("Reason for rejection (recorded in the audit log)"), { target: { value: "wrong" } });
    expect(rejectBtn().disabled).toBe(true);
    fireEvent.change(screen.getByLabelText("Reason for rejection (recorded in the audit log)"), { target: { value: "Order number does not match" } });
    fireEvent.click(rejectBtn());
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ note: "Order number does not match" });
  });

  it("a self-approval refusal (403 SELF_APPROVAL_FORBIDDEN) reads as a plain sentence", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "SELF_APPROVAL_FORBIDDEN", message: "a salary revision must be decided by someone other than its creator" }), { status: 403 }));
    renderList();
    fireEvent.click(screen.getByRole("button", { name: "Approve the salary revision for Asha Rao (EMP-1)" }));
    await screen.findByText("Approve this salary revision?");
    const buttons = screen.getAllByRole("button", { name: "Approve" });
    fireEvent.click(buttons[buttons.length - 1]!);
    await waitFor(() => expect(screen.getByText(/You entered this revision/)).toBeInTheDocument());
    expect(screen.queryByText(/someone other than its creator/)).not.toBeInTheDocument();
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
