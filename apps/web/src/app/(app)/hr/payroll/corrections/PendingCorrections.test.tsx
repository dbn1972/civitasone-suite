import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { PendingCorrections, type PendingCorrection } from "./PendingCorrections";

const ROW: PendingCorrection = {
  id: "00000000-0000-4000-8000-0000000000c1",
  employee_id: "00000000-0000-4000-8000-0000000000e1",
  component: "BASIC",
  effective_from: "2026-04-01",
  old_value_minor: 3000000,
  new_value_minor: 3500000,
  arrears_minor: 2000000,
  reason: null,
};

function renderList(rows: PendingCorrection[]) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <PendingCorrections rows={rows} />
    </NextIntlClientProvider>,
  );
}

/** GAP-PAYROLL-CORRECTIONS-01 */
describe("PendingCorrections — approve/reject", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows an empty message when nothing is pending", () => {
    renderList([]);
    expect(screen.getByText("No corrections are waiting for a decision.")).toBeInTheDocument();
  });

  it("approves via POST /corrections/:id/approve", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: ROW.id, status: "accepted", correlationId: "c" }), { status: 202 }));
    renderList([ROW]);
    fireEvent.click(screen.getByRole("button", { name: "Approve BASIC correction" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toContain(`/api/proxy/v1/payroll/corrections/${ROW.id}/approve`);
    await waitFor(() => expect(screen.getByText("BASIC correction approval submitted.")).toBeInTheDocument());
    expect(refreshMock).toHaveBeenCalled();
  });

  it("requires a reason to reject and sends it as the note", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: ROW.id, status: "accepted", correlationId: "c" }), { status: 202 }));
    renderList([ROW]);
    fireEvent.click(screen.getByRole("button", { name: "Reject BASIC correction" }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Reject" });
    expect(confirm).toBeDisabled();
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Order not yet issued" } });
    fireEvent.click(confirm);
    await waitFor(() => expect(fetchMock).toHaveBeenCalled());
    expect(String(fetchMock.mock.calls[0]![0])).toContain("/reject");
    expect(JSON.parse(String((fetchMock.mock.calls[0]![1] as RequestInit).body))).toEqual({ note: "Order not yet issued" });
  });

  it("explains the maker-checker refusal when the creator tries to approve", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "SELF_APPROVAL_FORBIDDEN", message: "raw" }), { status: 403 }));
    renderList([ROW]);
    fireEvent.click(screen.getByRole("button", { name: "Approve BASIC correction" }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Approve" }));
    await waitFor(() => expect(screen.getByText("You created this correction, so another payroll user must decide it.")).toBeInTheDocument());
    expect(screen.queryByText("raw")).not.toBeInTheDocument();
  });
});
