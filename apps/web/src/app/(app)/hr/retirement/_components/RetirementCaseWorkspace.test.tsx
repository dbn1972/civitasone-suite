import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ToastProvider } from "@/app/_components/ds";
import { RetirementCaseWorkspace } from "./RetirementCaseWorkspace";
import type { RetirementRow } from "./RetirementDashboard";

const fetchMock = vi.fn();

function inDays(n: number): string {
  const d = new Date();
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
}

function rows(): RetirementRow[] {
  return [
    { id: "r1", employee: "Asha Rao", superannuationDate: inDays(60), status: "initiated" },
    { id: "r2", employee: "Vikram Shah", superannuationDate: inDays(10), status: "initiated" },
  ];
}

function renderWorkspace(rowsArg: RetirementRow[]) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ToastProvider>
        <RetirementCaseWorkspace rows={rowsArg} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

// GAP-HR-RETIREMENT-01: the wizard is now backed by GET/PUT
// /v1/hrms/separations/:id/checklist, keyed on each retiree's own
// separationId (row.id) -- previously pure client useState with no fetch
// at all, so switching cases relied entirely on the `key`-triggered
// remount rather than any real per-case data source.
describe("RetirementCaseWorkspace", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    fetchMock.mockResolvedValue({ ok: true, status: 200, json: () => Promise.resolve({ data: [], ppoIssuedAt: null }) });
    vi.stubGlobal("fetch", fetchMock);
  });

  it("defaults the wizard to the soonest-retiring employee, not a generic unattributed checklist", async () => {
    renderWorkspace(rows());
    // "Vikram Shah" appears both as the dashboard card heading and the
    // wizard's "Processing retirement for:" line -- assert the latter,
    // unique string.
    await waitFor(() => expect(screen.getByText("Processing retirement for: Vikram Shah")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/proxy/v1/hrms/separations/r2/checklist", expect.anything());
  });

  it("switches the wizard to a different retiree, and fetches that retiree's own checklist", async () => {
    renderWorkspace(rows());
    await waitFor(() => expect(screen.getByText("Processing retirement for: Vikram Shah")).toBeInTheDocument());

    fetchMock.mockClear();
    fireEvent.click(screen.getByRole("button", { name: /Process this retirement/ }));

    await waitFor(() => expect(screen.getByText("Processing retirement for: Asha Rao")).toBeInTheDocument());
    expect(fetchMock).toHaveBeenCalledWith("/api/proxy/v1/hrms/separations/r1/checklist", expect.anything());
  });

  it("still renders a usable wizard when there are no upcoming retirements", () => {
    renderWorkspace([]);
    expect(screen.getByText(/No retiree selected/)).toBeInTheDocument();
  });
});
