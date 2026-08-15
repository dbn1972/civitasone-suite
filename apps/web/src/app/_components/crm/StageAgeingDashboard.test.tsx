import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { StageAgeingDashboard } from "./StageAgeingDashboard";
import * as op from "@/lib/crm/opportunity";

vi.mock("@/lib/crm/opportunity", async (orig) => {
  const actual = await orig<typeof import("@/lib/crm/opportunity")>();
  return {
    ...actual,
    getStageAgeing: vi.fn(),
    getStageLimits: vi.fn(),
    createStageLimit: vi.fn(),
    updateStageLimit: vi.fn(),
    deleteStageLimit: vi.fn(),
  };
});

beforeEach(() => {
  vi.mocked(op.getStageAgeing).mockReset().mockResolvedValue({ data: [], source: "api" });
  vi.mocked(op.getStageLimits).mockReset().mockResolvedValue({ data: [], source: "api" });
  vi.mocked(op.createStageLimit).mockReset();
  vi.mocked(op.updateStageLimit).mockReset();
  vi.mocked(op.deleteStageLimit).mockReset();
});

describe("StageAgeingDashboard (OP-005)", () => {
  it("lists opportunities exceeding their stage limit, worst first", async () => {
    vi.mocked(op.getStageAgeing).mockResolvedValue({
      data: [
        { id: "d1", name: "Slow deal", stage: "qual", stageName: "Qualify", daysInStage: 30, limitDays: 14, exceededBy: 16 },
        { id: "d2", name: "Slower deal", stage: "propose", stageName: "Propose", daysInStage: 60, limitDays: 20, exceededBy: 40 },
      ],
      source: "api",
    });
    render(<StageAgeingDashboard />);
    await waitFor(() => expect(screen.getByText("Slow deal")).toBeInTheDocument());
    const rows = screen.getAllByRole("row").filter((r) => /deal/i.test(r.textContent ?? ""));
    // worst (over by 40) should sort above (over by 16)
    expect(rows[0].textContent).toMatch(/Slower deal/);
  });

  it("gates the ageing table on a failed fetch", async () => {
    vi.mocked(op.getStageAgeing).mockResolvedValue({ data: [], source: "error" });
    render(<StageAgeingDashboard />);
    await waitFor(() => expect(screen.getAllByText(/showing saved information/i).length).toBeGreaterThan(0));
  });

  it("creates a stage limit", async () => {
    vi.mocked(op.createStageLimit).mockResolvedValue(undefined);
    render(<StageAgeingDashboard />);
    await waitFor(() => expect(screen.getByText(/no stage limits yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add stage limit/i }));
    fireEvent.change(screen.getByLabelText(/stage for limit 1/i), { target: { value: "qual" } });
    fireEvent.change(screen.getByLabelText(/days limit for 1/i), { target: { value: "14" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    // maxDays + enabled is the service's contract; this asserted `limitDays`,
    // which the API neither accepts nor returns.
    await waitFor(() => expect(op.createStageLimit).toHaveBeenCalledWith(expect.objectContaining({ stage: "qual", maxDays: 14, enabled: true })));
  });

  it("blocks a zero-day limit", async () => {
    render(<StageAgeingDashboard />);
    await waitFor(() => expect(screen.getByText(/no stage limits yet/i)).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: /add stage limit/i }));
    fireEvent.change(screen.getByLabelText(/stage for limit 1/i), { target: { value: "qual" } });
    fireEvent.change(screen.getByLabelText(/days limit for 1/i), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: /create/i }));
    expect(await screen.findByText(/greater than zero/i)).toBeInTheDocument();
    expect(op.createStageLimit).not.toHaveBeenCalled();
  });
});
