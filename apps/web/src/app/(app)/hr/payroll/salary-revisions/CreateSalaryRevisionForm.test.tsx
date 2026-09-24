import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateSalaryRevisionForm } from "./CreateSalaryRevisionForm";

describe("CreateSalaryRevisionForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires an employee id before opening the confirm dialog", () => {
    render(<CreateSalaryRevisionForm />);
    fireEvent.click(screen.getByRole("button", { name: "Record Revision" }));
    expect(screen.getByText("Employee ID is required.")).toBeInTheDocument();
  });

  it("requires a valid effective date", () => {
    render(<CreateSalaryRevisionForm />);
    fireEvent.change(screen.getByLabelText(/^Employee ID/), { target: { value: "e1" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Revision" }));
    expect(screen.getByText("Effective date must be in YYYY-MM-DD format.")).toBeInTheDocument();
  });

  it("requires a positive new basic amount", () => {
    render(<CreateSalaryRevisionForm />);
    fireEvent.change(screen.getByLabelText(/^Employee ID/), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText(/^Effective Date/), { target: { value: "2026-08-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Revision" }));
    expect(screen.getByText("New basic must be a positive value in rupees.")).toBeInTheDocument();
  });

  it("creates a salary revision on confirm (happy path), POSTing minor-unit amounts", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "sr1", status: "accepted", correlationId: "c1" }), { status: 202 }),
    );

    render(<CreateSalaryRevisionForm />);
    fireEvent.change(screen.getByLabelText(/^Employee ID/), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText(/^Effective Date/), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText(/^New Basic/), { target: { value: "44000" } });
    fireEvent.change(screen.getByLabelText(/^New Gross/), { target: { value: "88000" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Revision" }));

    await waitFor(() => expect(screen.getByText("Record this salary revision?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record revision"));

    await waitFor(() => {
      expect(screen.getByText(/Salary revision to .* recorded for employee e1\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();

    // The route this wires up (POST /v1/payroll/salary-revisions) takes
    // amounts in minor units (paise) -- rupees typed in the form must be
    // converted, not sent as-is.
    const call = fetchSpy.mock.calls.find(([url]) => String(url).includes("v1/payroll/salary-revisions"));
    expect(call).toBeDefined();
    const body = JSON.parse((call![1] as RequestInit).body as string);
    expect(body.employeeId).toBe("e1");
    expect(body.effectiveDate).toBe("2026-08-01");
    expect(body.newBasicMinor).toBe(4400000);
    expect(body.newGrossMinor).toBe(8800000);
    expect(body.revisionType).toBe("annual_increment");
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/status", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));

    render(<CreateSalaryRevisionForm />);
    fireEvent.change(screen.getByLabelText(/^Employee ID/), { target: { value: "e1" } });
    fireEvent.change(screen.getByLabelText(/^Effective Date/), { target: { value: "2026-08-01" } });
    fireEvent.change(screen.getByLabelText(/^New Basic/), { target: { value: "44000" } });
    fireEvent.change(screen.getByLabelText(/^New Gross/), { target: { value: "88000" } });
    fireEvent.click(screen.getByRole("button", { name: "Record Revision" }));

    await waitFor(() => expect(screen.getByText("Record this salary revision?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Record revision"));

    await waitFor(() => {
      expect(screen.getByText(/couldn't save/i)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 400/)).not.toBeInTheDocument();
  });
});
