import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { PerquisiteComponentForm } from "./PerquisiteComponentForm";

describe("PerquisiteComponentForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires an employee ID before opening the confirm dialog", () => {
    render(<PerquisiteComponentForm defaultEmployeeId="" defaultFy="" />);
    fireEvent.click(screen.getByRole("button", { name: "Save Component" }));
    expect(screen.getByText("Employee ID and financial year are required.")).toBeInTheDocument();
  });

  it("saves a perquisite component on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: "perquisite component saved" }), { status: 201 }),
    );

    render(<PerquisiteComponentForm defaultEmployeeId="e1" defaultFy="2026-27" />);
    fireEvent.change(screen.getByLabelText(/Value by Employer/), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Component" }));

    await waitFor(() => expect(screen.getByText("Save this perquisite component?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => {
      expect(screen.getByText(/Perquisite component "accommodation" saved for e1\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));

    render(<PerquisiteComponentForm defaultEmployeeId="e1" defaultFy="2026-27" />);
    fireEvent.change(screen.getByLabelText(/Value by Employer/), { target: { value: "1000" } });
    fireEvent.click(screen.getByRole("button", { name: "Save Component" }));

    await waitFor(() => expect(screen.getByText("Save this perquisite component?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Confirm & Save"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 400/)).toBeInTheDocument();
    });
  });
});
