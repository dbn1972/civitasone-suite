import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateSalaryRevisionForm } from "./CreateSalaryRevisionForm";

function fillRequiredFields() {
  fireEvent.change(screen.getByLabelText(/^Employee ID/), { target: { value: "e1" } });
  fireEvent.change(screen.getByLabelText(/^Effective Date/), { target: { value: "2026-04-01" } });
  fireEvent.change(screen.getByLabelText(/^Old Basic/), { target: { value: "40000" } });
  fireEvent.change(screen.getByLabelText(/^New Basic/), { target: { value: "44000" } });
  fireEvent.change(screen.getByLabelText(/^Old Gross/), { target: { value: "80000" } });
  fireEvent.change(screen.getByLabelText(/^New Gross/), { target: { value: "88000" } });
}

describe("CreateSalaryRevisionForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires an employee id before opening the confirm dialog", () => {
    render(<CreateSalaryRevisionForm />);
    fireEvent.click(screen.getByRole("button", { name: "Create Revision" }));
    expect(screen.getByText("Employee ID is required.")).toBeInTheDocument();
  });

  it("creates a salary revision on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            id: "sr1", employee_id: "e1", effective_date: "2026-04-01",
            old_basic_minor: 4000000, new_basic_minor: 4400000, revision_type: "annual_increment",
          },
        }),
        { status: 201 },
      ),
    );

    render(<CreateSalaryRevisionForm />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create Revision" }));

    await waitFor(() => expect(screen.getByText("Create this salary revision?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create revision"));

    await waitFor(() => {
      expect(screen.getByText(/Salary revision for employee "e1" created\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 404 }));

    render(<CreateSalaryRevisionForm />);
    fillRequiredFields();
    fireEvent.click(screen.getByRole("button", { name: "Create Revision" }));

    await waitFor(() => expect(screen.getByText("Create this salary revision?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create revision"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 404/)).toBeInTheDocument();
    });
  });
});
