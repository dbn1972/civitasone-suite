import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ShiftRequestsTable, type ShiftRequestRow } from "./ShiftRequestsTable";

/**
 * CRITICAL fix regression test: the shift-change feature had no approve/
 * reject control anywhere, despite PATCH /v1/hrms/shift-requests/:id/
 * approve|reject already working (WAVE-4).
 */
const PENDING: ShiftRequestRow = {
  id: "sr-1",
  employeeId: "emp-1",
  employeeName: "Priya Nair",
  currentShift: "General Duty",
  requestedShift: "Morning Shift",
  effectiveDate: "2026-10-01",
  reason: "Family care",
  status: "pending",
};

function renderTable(rows: ShiftRequestRow[], canApprove = true) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ShiftRequestsTable rows={rows} canApprove={canApprove} />
    </NextIntlClientProvider>,
  );
}

describe("ShiftRequestsTable", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("shows no decision controls when the viewer cannot approve", () => {
    renderTable([PENDING], false);
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /reject/i })).not.toBeInTheDocument();
  });

  it("shows no decision controls for an already-decided request", () => {
    renderTable([{ ...PENDING, status: "approved" }], true);
    expect(screen.queryByRole("button", { name: /approve/i })).not.toBeInTheDocument();
  });

  it("approves a pending request: PATCHes .../approve", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "sr-1", status: "approved" }), { status: 202 }));
    renderTable([PENDING], true);

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/approval remarks/i), { target: { value: "Approved" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/shift-requests/sr-1/approve",
      expect.objectContaining({ method: "PATCH" }),
    ));
    await waitFor(() => expect(screen.getByRole("status")).toHaveTextContent(/approved/i));
  });

  it("rejects a pending request: PATCHes .../reject with the reason", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: "sr-1", status: "rejected" }), { status: 202 }));
    renderTable([PENDING], true);

    fireEvent.click(screen.getByRole("button", { name: /^reject$/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/reason for rejection/i), { target: { value: "Staffing conflict" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^reject$/i }));

    await waitFor(() => expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/shift-requests/sr-1/reject",
      expect.objectContaining({ method: "PATCH" }),
    ));
    const [, options] = fetchMock.mock.calls[0];
    expect(JSON.parse(options.body)).toEqual({ reason: "Staffing conflict" });
  });

  it("shows a clerk-safe error, not the raw HTTP status, when the decision fails", async () => {
    fetchMock.mockResolvedValue(new Response("", { status: 403 }));
    renderTable([PENDING], true);

    fireEvent.click(screen.getByRole("button", { name: /^approve$/i }));
    const dialog = await screen.findByRole("alertdialog");
    fireEvent.change(within(dialog).getByLabelText(/approval remarks/i), { target: { value: "ok" } });
    fireEvent.click(within(dialog).getByRole("button", { name: /^approve$/i }));

    await waitFor(() => expect(dialog).toHaveTextContent(/couldn't save/i));
    expect(dialog.textContent).not.toMatch(/\b403\b/);
  });
});
