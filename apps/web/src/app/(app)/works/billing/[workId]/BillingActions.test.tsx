import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/app/_components/ds/Toast";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { BillingActions } from "./BillingActions";

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

const BILLS = [{ id: "b1", billNo: "BILL/001", status: "so_finalized" }];

/**
 * UX-016: both the bill-finalize and MB-finalize actions used to fall back
 * to `await res.text().catch(() => "Request failed")` verbatim on failure —
 * the same class of raw-status/raw-text leak useFormError closes fleet-wide
 * (UX-003). Each independent action now routes through its own
 * useFormError instance.
 */
describe("BillingActions — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("shows a clerk-safe message, never the raw server text, when a bill finalize fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Conflict: bill already at this status", { status: 409 }),
    );
    renderWithToast(<BillingActions bills={BILLS} />);

    fireEvent.click(screen.getByRole("button", { name: /→ Sdo Finalized/i }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Advance" }));

    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/Conflict: bill already at this status/)).not.toBeInTheDocument();
    expect(screen.queryByText(/409/)).not.toBeInTheDocument();
  });

  it("shows a clerk-safe message, never the raw server text, when an MB finalize fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Not Found", { status: 404 }));
    renderWithToast(<BillingActions bills={[]} />);

    fireEvent.change(screen.getByPlaceholderText("Paste full MB UUID"), {
      target: { value: "11111111-1111-1111-1111-111111111111" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Advance MB" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Advance" }));

    // This component shows the resolved message twice by design — once in
    // its own inline status paragraph, once inside the ConfirmDialog itself
    // — so assert on "at least one", not a single unique match.
    await waitFor(() => expect(screen.getAllByText(/couldn't save/i).length).toBeGreaterThan(0));
    expect(screen.queryByText("Not Found")).not.toBeInTheDocument();
  });
});
