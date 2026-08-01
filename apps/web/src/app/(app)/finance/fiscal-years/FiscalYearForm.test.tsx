import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { FiscalYearForm } from "./FiscalYearForm";

describe("FiscalYearForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("validates the code format before opening the confirm dialog", () => {
    render(<FiscalYearForm />);
    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "bad-code" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Fiscal Year" }));
    expect(screen.getByText("Code must be in YYYY-YY format, e.g. 2026-27.")).toBeInTheDocument();
  });

  it("creates a fiscal year on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "fy-1", status: "created" }), { status: 201 }),
    );

    render(<FiscalYearForm />);
    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "2026-27" } });
    fireEvent.change(screen.getByLabelText(/^Label/), { target: { value: "FY 2026-27" } });
    fireEvent.change(screen.getByLabelText(/^Start Date/), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText(/^End Date/), { target: { value: "2027-03-31" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Fiscal Year" }));
    await waitFor(() => expect(screen.getByText("Create this fiscal year?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create fiscal year"));

    await waitFor(() => {
      expect(screen.getByText("Fiscal year 2026-27 created.")).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<FiscalYearForm />);
    fireEvent.change(screen.getByLabelText(/^Code/), { target: { value: "2026-27" } });
    fireEvent.change(screen.getByLabelText(/^Label/), { target: { value: "FY 2026-27" } });
    fireEvent.change(screen.getByLabelText(/^Start Date/), { target: { value: "2026-04-01" } });
    fireEvent.change(screen.getByLabelText(/^End Date/), { target: { value: "2027-03-31" } });

    fireEvent.click(screen.getByRole("button", { name: "Create Fiscal Year" }));
    await waitFor(() => expect(screen.getByText("Create this fiscal year?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create fiscal year"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
