import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { OffCycleCards } from "./OffCycleCard";
import type { OffCycleRow } from "./types";

const DRAFT: OffCycleRow = {
  id: "00000000-0000-4000-8000-000000000001",
  run_type: "bonus",
  period: "2026-09",
  description: null,
  total_amount_minor: 1000000,
  total_tax_minor: 0,
  total_net_minor: 0,
  status: "draft",
  created_at: "2026-09-01T00:00:00Z",
};

function renderCards(rows: OffCycleRow[], canProcess: boolean) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OffCycleCards rows={rows} canProcess={canProcess} />
    </NextIntlClientProvider>,
  );
}

/** GAP-PAYROLL-OFF-CYCLE-01 */
describe("OffCycleCards — maker-checker processing", () => {
  const fetchMock = vi.fn();
  beforeEach(() => {
    fetchMock.mockReset();
    refreshMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => vi.unstubAllGlobals());

  it("hides Process Run from a role that cannot process (server is PAYROLL_ROLES-only)", () => {
    renderCards([DRAFT], false);
    expect(screen.queryByRole("button", { name: /process bonus disbursement run/i })).not.toBeInTheDocument();
  });

  it("no longer shows a separate 'Approval Status' that merely echoed status", () => {
    renderCards([DRAFT], true);
    expect(screen.queryByText("Approval Status")).not.toBeInTheDocument();
    expect(screen.getByText(/someone other than|other than the one who created/i)).toBeInTheDocument();
  });

  it("tells the creator that another payroll user must process the run (403 SELF_APPROVAL_FORBIDDEN)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ code: "SELF_APPROVAL_FORBIDDEN", message: "x" }), { status: 403 }));
    renderCards([DRAFT], true);
    fireEvent.click(screen.getByRole("button", { name: /process bonus disbursement run/i }));
    // GAP-PAYROLL-OFF-CYCLE-04 (b3): processing now needs a reason.
    fireEvent.change(await screen.findByLabelText(/Reason/), { target: { value: "Quarterly incentive approved by DDO" } });
    fireEvent.click(await screen.findByText("Process run"));
    await waitFor(() => expect(screen.getByText("You created this run, so another payroll user must process it.")).toBeInTheDocument());
    expect(refreshMock).not.toHaveBeenCalled();
  });

  it("treats the 202 accepted envelope as success (it used to read res.data.totalNetMinor and throw)", async () => {
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ id: DRAFT.id, status: "accepted", correlationId: "c" }), { status: 202 }));
    renderCards([DRAFT], true);
    fireEvent.click(screen.getByRole("button", { name: /process bonus disbursement run/i }));
    // GAP-PAYROLL-OFF-CYCLE-04 (b3): processing now needs a reason.
    fireEvent.change(await screen.findByLabelText(/Reason/), { target: { value: "Quarterly incentive approved by DDO" } });
    fireEvent.click(await screen.findByText("Process run"));
    await waitFor(() => expect(screen.getByText(/submitted for processing/)).toBeInTheDocument());
    expect(refreshMock).toHaveBeenCalled();
  });
});
