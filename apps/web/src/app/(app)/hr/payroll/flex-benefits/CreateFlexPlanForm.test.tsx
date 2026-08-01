import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateFlexPlanForm } from "./CreateFlexPlanForm";

describe("CreateFlexPlanForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a plan name before opening the confirm dialog", () => {
    render(<CreateFlexPlanForm />);
    fireEvent.click(screen.getByRole("button", { name: "Create Plan" }));
    expect(screen.getByText("Plan name is required.")).toBeInTheDocument();
  });

  it("creates a plan on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({ data: { id: "pl1", name: "FY26 Flex Plan", fy: "2025-26", totalBudgetMinor: 1000000, status: "active" } }),
        { status: 201 },
      ),
    );

    render(<CreateFlexPlanForm />);
    fireEvent.change(screen.getByLabelText(/^Plan Name/), { target: { value: "FY26 Flex Plan" } });
    fireEvent.change(screen.getByLabelText(/^Financial Year/), { target: { value: "2025-26" } });
    fireEvent.change(screen.getByLabelText(/^Total Budget/), { target: { value: "10000" } });
    fireEvent.change(screen.getByLabelText("Component Name"), { target: { value: "LTA" } });
    fireEvent.change(screen.getByLabelText("Max Amount (₹)"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Plan" }));

    await waitFor(() => expect(screen.getByText("Create this flex benefit plan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create plan"));

    await waitFor(() => {
      expect(screen.getByText(/Flex benefit plan "FY26 Flex Plan" created\./)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 409 }));

    render(<CreateFlexPlanForm />);
    fireEvent.change(screen.getByLabelText(/^Plan Name/), { target: { value: "FY26 Flex Plan" } });
    fireEvent.change(screen.getByLabelText(/^Financial Year/), { target: { value: "2025-26" } });
    fireEvent.change(screen.getByLabelText(/^Total Budget/), { target: { value: "10000" } });
    fireEvent.change(screen.getByLabelText("Component Name"), { target: { value: "LTA" } });
    fireEvent.change(screen.getByLabelText("Max Amount (₹)"), { target: { value: "5000" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Plan" }));

    await waitFor(() => expect(screen.getByText("Create this flex benefit plan?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create plan"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 409/)).toBeInTheDocument();
    });
  });
});
