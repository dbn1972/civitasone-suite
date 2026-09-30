import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";
import { ToastProvider } from "@/app/_components/ds";
import { RetirementProcessWizard } from "./RetirementProcessWizard";

const fetchMock = vi.fn();

function jsonResponse(body: unknown, ok = true) {
  return Promise.resolve({ ok, status: ok ? 200 : 500, json: () => Promise.resolve(body) });
}

function renderWizard(props: { separationId?: string; employeeName?: string } = {}) {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      <ToastProvider>
        <RetirementProcessWizard {...props} />
      </ToastProvider>
    </NextIntlClientProvider>,
  );
}

describe("RetirementProcessWizard (GAP-HR-RETIREMENT-01)", () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.stubGlobal("fetch", fetchMock);
  });

  it("shows a neutral message and no checklist fetch when no retiree is selected", () => {
    renderWizard({});
    expect(screen.getByText(/No retiree selected/)).toBeInTheDocument();
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("loads the persisted checklist state for the selected retiree (was: pure client state, always empty on mount)", async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse({ data: [{ stepId: "1", checkIndex: 0, done: true }], ppoIssuedAt: null }),
    );
    renderWizard({ separationId: "sep-1", employeeName: "Priya Nair" });
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/separations/sep-1/checklist",
      expect.objectContaining({ signal: expect.anything() }),
    );
    await waitFor(() => expect(screen.getByText("Processing retirement for: Priya Nair")).toBeInTheDocument());
    // The first checkbox (step 1, check 0) should reflect the persisted "done".
    const firstCheckbox = screen.getAllByRole("checkbox")[0];
    await waitFor(() => expect(firstCheckbox).toBeChecked());
  });

  it("toggling a checkbox sends a PUT and rolls back on failure", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ data: [], ppoIssuedAt: null })); // initial GET
    renderWizard({ separationId: "sep-1" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));

    fetchMock.mockReturnValueOnce(Promise.resolve({ ok: false, status: 500 })); // failing PUT
    const firstCheckbox = screen.getAllByRole("checkbox")[0];
    fireEvent.click(firstCheckbox);
    expect(firstCheckbox).toBeChecked(); // optimistic
    await waitFor(() => expect(firstCheckbox).not.toBeChecked()); // rolled back
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/hrms/separations/sep-1/checklist",
      expect.objectContaining({ method: "PUT" }),
    );
  });

  it("disables Issue PPO until all 25 checks are done", async () => {
    fetchMock.mockReturnValueOnce(jsonResponse({ data: [], ppoIssuedAt: null }));
    renderWizard({ separationId: "sep-1" });
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    // Navigate to the last step's panel to find the Issue PPO button.
    fireEvent.click(screen.getByRole("tab", { name: /5\./ }));
    expect(screen.getByRole("button", { name: "Issue PPO" })).toBeDisabled();
  });

  it("shows a read-only, permanent record once the PPO has already been issued", async () => {
    fetchMock.mockReturnValueOnce(
      jsonResponse({ data: [{ stepId: "1", checkIndex: 0, done: true }], ppoIssuedAt: "2026-01-01T00:00:00Z" }),
    );
    renderWizard({ separationId: "sep-1" });
    await waitFor(() => expect(screen.getByText(/now a permanent, read-only record/)).toBeInTheDocument());
    expect(screen.getAllByRole("checkbox")[0]).toBeDisabled();
  });
});
