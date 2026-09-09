import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const mockPush = vi.fn();
const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: mockRefresh }),
}));

const toastSuccess = vi.fn();
vi.mock("@/app/_components/ds/Toast", () => ({
  useToast: () => ({ toast: { success: toastSuccess } }),
}));

vi.mock("@/lib/activation", () => ({ trackActivation: vi.fn() }));

vi.mock("../../../_components/ds", () => ({
  ConfirmDialog: ({
    open,
    errorMessage,
    onConfirm,
  }: {
    open: boolean;
    errorMessage?: string;
    onConfirm: () => void;
  }) =>
    open ? (
      <div>
        {errorMessage ? <p role="alert">{errorMessage}</p> : null}
        <button onClick={onConfirm}>Confirm create run</button>
      </div>
    ) : null,
}));

import { CreatePayrollRunForm } from "./CreatePayrollRunForm";

const STRUCTURES = [{ id: "s1", name: "Standard Grade Pay" }];

function fillAndOpenDialog() {
  render(<CreatePayrollRunForm structures={STRUCTURES} />);
  fireEvent.click(screen.getByRole("button", { name: "Create Run" }));
}

describe("CreatePayrollRunForm — server error handling (UX-003)", () => {
  beforeEach(() => {
    mockPush.mockReset();
    mockRefresh.mockReset();
    toastSuccess.mockReset();
    vi.restoreAllMocks();
  });

  it("renders inline field-level messages from a fieldErrors response, not just a raw error string", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          code: "VALIDATION_FAILED",
          message: "validation_failed",
          fieldErrors: [{ field: "runNo", message: "A run with this number already exists." }],
        }),
        { status: 409, headers: { "content-type": "application/json" } },
      ),
    );

    fillAndOpenDialog();
    fireEvent.click(screen.getByRole("button", { name: "Confirm create run" }));

    expect(
      await screen.findByText("A run with this number already exists."),
    ).toBeInTheDocument();
  });

  it("never surfaces a raw HTTP status code or raw server error text in the confirm dialog", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("Internal Server Error\n at Object.<anonymous> (/srv/payroll.js:20:4)", {
        status: 500,
        headers: { "content-type": "text/plain" },
      }),
    );

    fillAndOpenDialog();
    fireEvent.click(screen.getByRole("button", { name: "Confirm create run" }));

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).not.toMatch(/\b500\b/);
    expect(alert.textContent).not.toMatch(/Internal Server Error/);
    expect(alert.textContent).not.toMatch(/at Object\.<anonymous>/);
    // Regression: this form used to build `Create failed (${res.status})` directly.
    expect(alert.textContent).not.toMatch(/Create failed \(/);
  });

  it("still creates the run and redirects on success", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "run-1" }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    fillAndOpenDialog();
    fireEvent.click(screen.getByRole("button", { name: "Confirm create run" }));

    await waitFor(() => expect(mockPush).toHaveBeenCalledWith("/hr/payroll/run-1"));
  });
});
