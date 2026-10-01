import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ReimbursementsTable, type ClaimRow } from "./ReimbursementsTable";

const ROW: ClaimRow = {
  id: "cccccccc-3333-4333-8333-333333333301",
  employee_label: "Farah Khan (EMP-31)",
  category_label: "LTA",
  amount_minor: "250000",
  period_display: "Jul 2026",
  bill_date_display: "01/07/2026",
  bill_ref: "BILL-1",
  status: "submitted",
};

function renderTable(canDecide = true, rows: ClaimRow[] = [ROW]) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ReimbursementsTable rows={rows} canDecide={canDecide} showEmployee />
    </NextIntlClientProvider>,
  );
}

function accepted() {
  return vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ id: ROW.id, status: "accepted", correlationId: "c" }), { status: 202 }),
  );
}

describe("ReimbursementsTable (GAP-PAYROLL-REIMBURSEMENTS-02)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("no decision buttons without canDecide, or on non-submitted claims", () => {
    renderTable(false);
    expect(screen.queryByRole("button", { name: /Approve claim/ })).not.toBeInTheDocument();
  });

  it("approve PATCHes /approve and refreshes", async () => {
    const fetchSpy = accepted();
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /^Approve claim/ }));
    const dialog = await screen.findByRole("alertdialog");
    expect(dialog).toHaveTextContent("Farah Khan (EMP-31)");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain(`/reimbursements/${ROW.id}/approve`);
    expect((init as RequestInit).method).toBe("PATCH");
    expect(document.querySelector(".pill.good")).toHaveTextContent("Claim of ₹2,500.00 approved.");
  });

  it("reject requires a reason of at least 10 characters and sends it", async () => {
    const fetchSpy = accepted();
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /^Reject claim/ }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Reject" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Bill amount does not match" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain(`/reimbursements/${ROW.id}/reject`);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ reason: "Bill amount does not match" });
  });

  it("shows the server's refusal (e.g. maker-checker) in the dialog", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "SELF_APPROVAL_FORBIDDEN", message: "you cannot decide your own reimbursement claim" }), { status: 403 }),
    );
    renderTable();
    fireEvent.click(screen.getByRole("button", { name: /^Approve claim/ }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(within(dialog).getByRole("alert")).toBeInTheDocument());
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
