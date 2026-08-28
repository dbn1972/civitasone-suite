import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/app/_components/ds/Toast";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ApprovalFinalizeButton } from "./ApprovalFinalizeButton";

const AA_ID = "11111111-2222-3333-4444-555555555555";

// The real Toast lives behind a provider (useToast throws otherwise); wrap so we
// render the true ConfirmDialog + Toast, not stubs.
function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

describe("ApprovalFinalizeButton", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("does NOT fire the finalize request until the officer confirms (L4: irreversible action must be guarded)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: AA_ID, status: "accepted" }), { status: 202 }));

    renderWithToast(<ApprovalFinalizeButton id={AA_ID} type="aa" status="draft" />);

    // A single click on the primary button must NOT mutate anything — it only
    // opens a confirmation dialog.
    fireEvent.click(screen.getByRole("button", { name: "Finalize AA" }));
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(screen.getByText("Finalize Administrative Approval")).toBeInTheDocument();

    // Only the explicit confirm issues the request.
    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));
    await waitFor(() => expect(fetchSpy).toHaveBeenCalledTimes(1));
    const [url, init] = fetchSpy.mock.calls[0];
    expect(url).toBe(`/api/proxy/v1/works/approvals/aa/${AA_ID}/finalize`);
    expect((init as RequestInit).method).toBe("POST");
  });

  it("does NOT claim the record is finalized on a 202-accepted response (L3: 202 != done)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: AA_ID, status: "accepted" }), { status: 202 }),
    );

    renderWithToast(<ApprovalFinalizeButton id={AA_ID} type="ts" status="draft" />);
    fireEvent.click(screen.getByRole("button", { name: "Finalize TS" }));
    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));

    // Truthful pending state — never a false "Finalized".
    await waitFor(() => expect(screen.getByText("⏳ Finalization pending")).toBeInTheDocument());
    expect(screen.queryByText("✓ Finalized")).not.toBeInTheDocument();
  });

  it("reflects a server-applied finalize after a refresh, derived from status (not an optimistic flag)", () => {
    const { rerender } = renderWithToast(<ApprovalFinalizeButton id={AA_ID} type="aa" status="draft" />);
    expect(screen.getByRole("button", { name: "Finalize AA" })).toBeInTheDocument();

    // router.refresh() re-renders the server component with the applied status.
    rerender(
      <ToastProvider>
        <ApprovalFinalizeButton id={AA_ID} type="aa" status="finalized" />
      </ToastProvider>,
    );
    expect(screen.getByText("✓ Finalized")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Finalize AA" })).not.toBeInTheDocument();
  });

  it("surfaces a server error inside the dialog without claiming success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "Cannot finalize: current status is 'submitted'" }), { status: 422 }),
    );

    renderWithToast(<ApprovalFinalizeButton id={AA_ID} type="aa" status="draft" />);
    fireEvent.click(screen.getByRole("button", { name: "Finalize AA" }));
    fireEvent.click(screen.getByRole("button", { name: "Finalize" }));

    await waitFor(() =>
      expect(screen.getByText("Cannot finalize: current status is 'submitted'")).toBeInTheDocument(),
    );
    expect(screen.queryByText("⏳ Finalization pending")).not.toBeInTheDocument();
    expect(screen.queryByText("✓ Finalized")).not.toBeInTheDocument();
  });
});
