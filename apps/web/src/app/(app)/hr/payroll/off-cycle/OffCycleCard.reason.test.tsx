import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { OffCycleCards } from "./OffCycleCard";
import type { OffCycleRow } from "./types";

const ROW: OffCycleRow = {
  id: "99999999-9999-4999-8999-999999999901",
  run_type: "bonus",
  period: "2025-06",
  description: null,
  total_amount_minor: "500000",
  total_tax_minor: 0,
  total_net_minor: 0,
  status: "draft",
  created_at: "2025-06-01T00:00:00Z",
  employee_count: 3,
};

function renderCards(canProcess = true) {
  render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <OffCycleCards rows={[ROW]} canProcess={canProcess} />
    </NextIntlClientProvider>,
  );
}

describe("OffCycleCards — b3 (employee count, mandatory reason)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("GAP-PAYROLL-OFF-CYCLE-02: shows the employees-in-scope count", () => {
    renderCards();
    expect(screen.getByText("Employees in Scope")).toBeInTheDocument();
    expect(screen.getByText("3")).toBeInTheDocument();
  });

  it("GAP-PAYROLL-OFF-CYCLE-06: no Process button without the admin flag", () => {
    renderCards(false);
    expect(screen.queryByRole("button", { name: /Process/ })).not.toBeInTheDocument();
  });

  it("GAP-PAYROLL-OFF-CYCLE-04: processing needs a reason, is styled destructive, and sends the reason (202 envelope)", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: ROW.id, status: "accepted", correlationId: "c" }), { status: 202 }),
    );
    renderCards();
    fireEvent.click(screen.getByRole("button", { name: /Process Bonus Disbursement run/ }));
    const dialog = await screen.findByRole("alertdialog");
    const confirm = within(dialog).getByRole("button", { name: "Process run" });
    expect(confirm).toBeDisabled();
    expect(confirm.className).toMatch(/danger/);
    fireEvent.change(within(dialog).getByLabelText(/Reason/), { target: { value: "Diwali bonus approved by DDO" } });
    expect(confirm).toBeEnabled();
    fireEvent.click(confirm);
    await waitFor(() => expect(document.querySelector(".pill.good")).toHaveTextContent("submitted for processing"));
    const [url, init] = fetchSpy.mock.calls[0]!;
    expect(String(url)).toContain(`/off-cycle/${ROW.id}/process`);
    expect(JSON.parse(String((init as RequestInit).body))).toEqual({ reason: "Diwali bonus approved by DDO" });
    expect(refreshMock).toHaveBeenCalled();
  });
});
