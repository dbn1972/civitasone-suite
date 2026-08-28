import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/app/_components/ds/Toast";

const { pushMock } = vi.hoisted(() => ({ pushMock: vi.fn() }));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: pushMock }),
  // Read live from the URL so each test controls it via history.replaceState.
  useSearchParams: () => new URLSearchParams(window.location.search),
}));

import { NewAaForm } from "./NewAaForm";

const WORK_ID = "123e4567-e89b-12d3-a456-426614174000";

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("NewAaForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    pushMock.mockReset();
  });

  it("pre-fills the Work ID from the ?workId param (L1: the 'Create AA →' context is not dropped)", () => {
    window.history.replaceState({}, "", `/works/approvals/new?workId=${WORK_ID}`);
    renderWithToast(<NewAaForm />);

    const workIdInput = screen.getByLabelText(/Work ID/i) as HTMLInputElement;
    expect(workIdInput.value).toBe(WORK_ID);
    expect(screen.getByText("Pre-filled from the selected proposal.")).toBeInTheDocument();
  });

  it("leaves the Work ID blank (and shows no pre-fill hint) when arrived at without a param", () => {
    window.history.replaceState({}, "", "/works/approvals/new");
    renderWithToast(<NewAaForm />);

    const workIdInput = screen.getByLabelText(/Work ID/i) as HTMLInputElement;
    expect(workIdInput.value).toBe("");
    expect(screen.queryByText("Pre-filled from the selected proposal.")).not.toBeInTheDocument();
  });

  it("carries the pre-filled workId through to the create request and reports async acceptance truthfully (L3: 202 != done)", async () => {
    window.history.replaceState({}, "", `/works/approvals/new?workId=${WORK_ID}`);
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "aa1", status: "accepted" }), { status: 202 }));

    renderWithToast(<NewAaForm />);

    fireEvent.change(screen.getByLabelText(/AA Number/i), { target: { value: "AA/2026-27/001" } });
    fireEvent.change(screen.getByLabelText(/Approval date/i), { target: { value: "2026-08-26" } });
    fireEvent.change(screen.getByLabelText(/Approving authority/i), { target: { value: "223e4567-e89b-12d3-a456-426614174999" } });
    fireEvent.change(screen.getByLabelText(/Approved amount/i), { target: { value: "500000" } });
    fireEvent.click(screen.getByRole("button", { name: "Create" }));

    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe("/api/proxy/v1/works/approvals/aa");
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.workId).toBe(WORK_ID);
    expect(body.approvedAmountMinor).toBe("50000000"); // ₹500000.00 -> paise

    // 202 accepted: truthful "submitted", not a false "created".
    await waitFor(() =>
      expect(
        screen.getByText("Administrative approval submitted. It will appear in the register once processed."),
      ).toBeInTheDocument(),
    );
  });
});
