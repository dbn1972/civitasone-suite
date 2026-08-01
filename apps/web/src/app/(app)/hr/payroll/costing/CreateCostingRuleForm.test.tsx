import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateCostingRuleForm } from "./CreateCostingRuleForm";

describe("CreateCostingRuleForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires employee group and cost center before opening the confirm dialog", () => {
    render(<CreateCostingRuleForm />);
    fireEvent.click(screen.getByText("Save Rule"));
    expect(screen.getByText("Employee group and cost center are required.")).toBeInTheDocument();
  });

  it("saves a costing rule on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { id: "cr-1", employeeGroup: "Group A", costCenterId: "cc-1", splitPct: 100 } }), { status: 201 }),
    );

    render(<CreateCostingRuleForm />);
    fireEvent.change(screen.getByLabelText(/Employee Group/), { target: { value: "Group A" } });
    fireEvent.change(screen.getByLabelText(/Cost Center ID/), { target: { value: "11111111-1111-1111-1111-111111111111" } });
    fireEvent.click(screen.getByText("Save Rule"));

    await waitFor(() => expect(screen.getByText("Save this costing rule?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Save rule"));

    await waitFor(() => {
      expect(screen.getByText(/Costing rule saved for Group A/)).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<CreateCostingRuleForm />);
    fireEvent.change(screen.getByLabelText(/Employee Group/), { target: { value: "Group A" } });
    fireEvent.change(screen.getByLabelText(/Cost Center ID/), { target: { value: "11111111-1111-1111-1111-111111111111" } });
    fireEvent.click(screen.getByText("Save Rule"));

    await waitFor(() => expect(screen.getByText("Save this costing rule?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Save rule"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
