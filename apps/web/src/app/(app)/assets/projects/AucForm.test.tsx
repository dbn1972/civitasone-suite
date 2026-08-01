import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { AucForm } from "./AucForm";

describe("AucForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a project code and name before opening the confirm dialog", () => {
    render(<AucForm />);
    fireEvent.click(screen.getByRole("button", { name: "Create AUC project" }));
    expect(screen.getByText("Project code is required.")).toBeInTheDocument();
    expect(screen.queryByText("Create this AUC project?")).not.toBeInTheDocument();
  });

  it("rejects an amount with more than two decimal places", () => {
    render(<AucForm />);
    fireEvent.change(screen.getByLabelText(/Project code/), { target: { value: "AUC-010" } });
    fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: "New Wing" } });
    fireEvent.change(screen.getByLabelText(/Accumulated cost/), { target: { value: "100.005" } });
    fireEvent.click(screen.getByRole("button", { name: "Create AUC project" }));
    expect(screen.getByText(/Enter a valid amount in rupees/)).toBeInTheDocument();
  });

  it("creates an AUC project on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "auc-1" }), { status: 202 }),
    );

    render(<AucForm />);
    fireEvent.change(screen.getByLabelText(/Project code/), { target: { value: "AUC-010" } });
    fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: "New Wing" } });
    fireEvent.change(screen.getByLabelText(/Accumulated cost/), { target: { value: "15000.50" } });

    fireEvent.click(screen.getByRole("button", { name: "Create AUC project" }));
    await waitFor(() => expect(screen.getByText("Create this AUC project?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & create"));

    await waitFor(() => {
      expect(screen.getByText(/AUC project "AUC-010" created\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();

    const call = (globalThis.fetch as ReturnType<typeof vi.fn>).mock.calls[0];
    const body = JSON.parse((call[1] as RequestInit).body as string) as { amountMinor: number };
    // 15000.50 rupees -> 1500050 paise via rupeesToMinorString (no float 100x drift).
    expect(body.amountMinor).toBe(1500050);
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "VALIDATION_FAILED", message: "invalid request" }), { status: 400 }),
    );

    render(<AucForm />);
    fireEvent.change(screen.getByLabelText(/Project code/), { target: { value: "AUC-011" } });
    fireEvent.change(screen.getByLabelText(/Project name/), { target: { value: "Depot Extension" } });

    fireEvent.click(screen.getByRole("button", { name: "Create AUC project" }));
    await waitFor(() => expect(screen.getByText("Create this AUC project?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & create"));

    await waitFor(() => {
      expect(screen.getByText(/VALIDATION_FAILED: invalid request/)).toBeInTheDocument();
    });
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
