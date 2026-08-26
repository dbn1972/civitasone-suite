import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ToastProvider } from "@/app/_components/ds";
import { SanctionCreateAction } from "./FinanceActions";

/**
 * L3 (money truthfulness): finance maker-checker commands return 202 Accepted
 * (queued, not done). Previously onSuccess only refreshed the route, so the
 * dialog closed over an unchanged page with no confirmation — the officer could
 * not tell the submission was accepted and might re-submit. Success must be
 * confirmed with an honest "submitted" message.
 */
describe("FinanceActions confirms an accepted (202) submission", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    vi.restoreAllMocks();
  });

  it("shows a 'submitted for approval' toast after a 202, and refreshes", async () => {
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(null, { status: 202 }));

    render(
      <ToastProvider>
        <SanctionCreateAction />
      </ToastProvider>,
    );

    fireEvent.click(screen.getByRole("button", { name: "+ New Sanction" }));
    await waitFor(() => expect(screen.getByText("Raise a new sanction?")).toBeInTheDocument());

    fireEvent.change(screen.getByLabelText("Proposing officer & purpose"), {
      target: { value: "DDO / office contingency" },
    });
    fireEvent.click(screen.getByText("Create draft"));

    await waitFor(() =>
      expect(screen.getByText("Draft sanction submitted for approval.")).toBeInTheDocument(),
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "/api/proxy/v1/finance/sanctions",
      expect.objectContaining({ method: "POST" }),
    );
    expect(refreshMock).toHaveBeenCalled();
  });
});
