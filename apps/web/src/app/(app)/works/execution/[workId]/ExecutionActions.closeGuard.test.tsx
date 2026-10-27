/**
 * Owner decision D4c #41: when the server refuses a closure because issues are open / progress is below 100% (or a
 * DAO reason / approval is missing), the officer is told exactly that, not a generic "couldn\'t save".
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor, within } from "@/test-utils/intl-render";
import type { ReactElement } from "react";
import { ToastProvider } from "@/app/_components/ds/Toast";

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import { ExecutionActions } from "./ExecutionActions";

const WORK_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";
const renderWithToast = (ui: ReactElement) => render(<ToastProvider>{ui}</ToastProvider>);
const refuse = (status: number, code: string) =>
  vi.spyOn(globalThis, "fetch").mockResolvedValue(
    new Response(JSON.stringify({ code, message: "server text that must not be shown" }), { status, headers: { "content-type": "application/json" } }),
  );
async function submitClose() {
  fireEvent.click(screen.getByRole("button", { name: "Close Work" }));
  const dialog = screen.getByRole("alertdialog");
  fireEvent.click(within(dialog).getByRole("button", { name: "Close Work" }));
}

describe("ExecutionActions: close guard messages (D4c #41)", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("tells the officer a completion closure is blocked by open issues or progress below 100%", async () => {
    refuse(422, "CLOSURE_BLOCKED");
    renderWithToast(<ExecutionActions workId={WORK_ID} />);
    await submitClose();
    await waitFor(() => expect(screen.getAllByText(/open issues or progress is below 100%/i).length).toBeGreaterThan(0));
    expect(screen.queryByText(/server text that must not be shown/)).toBeNull();
  });

  it("asks for a reason when the server says one is required", async () => {
    refuse(422, "CLOSURE_REASON_REQUIRED");
    renderWithToast(<ExecutionActions workId={WORK_ID} />);
    await submitClose();
    await waitFor(() => expect(screen.getAllByText(/give a reason/i).length).toBeGreaterThan(0));
  });

  it("says the DAO must approve when the caller may not", async () => {
    refuse(403, "DAO_APPROVAL_REQUIRED");
    renderWithToast(<ExecutionActions workId={WORK_ID} />);
    await submitClose();
    await waitFor(() => expect(screen.getAllByText(/DAO must approve/i).length).toBeGreaterThan(0));
  });

  it("offers the reason box for an early close too (Closed), not only for Dropped", () => {
    renderWithToast(<ExecutionActions workId={WORK_ID} />);
    expect(screen.queryByLabelText(/reason/i)).toBeNull();
    fireEvent.change(screen.getByLabelText("Closure Type"), { target: { value: "closed" } });
    expect(screen.getByLabelText(/reason/i)).toBeInTheDocument();
  });
});
