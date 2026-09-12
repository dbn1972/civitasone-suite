import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@testing-library/react";
import type { ReactElement } from "react";
import { ToastProvider } from "@/app/_components/ds/Toast";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { ExecutionActions } from "./ExecutionActions";

function renderWithToast(ui: ReactElement) {
  return render(<ToastProvider>{ui}</ToastProvider>);
}

const WORK_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

/**
 * UX-016: both the physical-completion and work-closure actions used to
 * fall back to `await res.text().catch(() => "Request failed")` verbatim on
 * failure — the same class of raw-status/raw-text leak useFormError closes
 * fleet-wide (UX-003). Each independent action now routes through its own
 * useFormError instance.
 */
describe("ExecutionActions — UX-016 clerk-safe errors", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  // This component shows the resolved message twice by design — once in its
  // own inline status paragraph, once inside the ConfirmDialog itself — so
  // assertions below check "at least one" match, not a single unique one.
  it("shows a clerk-safe message, never the raw server text, when marking physical completion fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("Request failed", { status: 500 }));
    renderWithToast(<ExecutionActions workId={WORK_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Mark Complete" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Mark Complete" }));

    await waitFor(() => expect(screen.getAllByText(/couldn't save/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/^Request failed$/)).not.toBeInTheDocument();
  });

  it("shows a clerk-safe message, never the raw HTTP status, when work closure fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({}), { status: 409, headers: { "content-type": "application/json" } }),
    );
    renderWithToast(<ExecutionActions workId={WORK_ID} />);

    fireEvent.click(screen.getByRole("button", { name: "Close Work" }));
    const dialog = screen.getByRole("alertdialog");
    fireEvent.click(within(dialog).getByRole("button", { name: "Close Work" }));

    await waitFor(() => expect(screen.getAllByText(/couldn't save/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/409/)).not.toBeInTheDocument();
  });
});
