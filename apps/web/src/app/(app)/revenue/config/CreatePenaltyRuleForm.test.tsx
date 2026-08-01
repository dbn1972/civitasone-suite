import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreatePenaltyRuleForm } from "./CreatePenaltyRuleForm";

describe("CreatePenaltyRuleForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires an annual interest rate before opening the confirm dialog", () => {
    render(<CreatePenaltyRuleForm rateHeadId="rh1" rateHeadLabel="PT — Property Tax" />);
    fireEvent.click(screen.getByRole("button", { name: "Create Penalty Rule" }));
    expect(screen.getByText(/Annual Interest Rate \(%\) is required/)).toBeInTheDocument();
  });

  it("converts the percent rate to basis points and creates the rule on confirm (happy path)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "p-1", status: "accepted" }), { status: 202 }));

    render(<CreatePenaltyRuleForm rateHeadId="rh1" rateHeadLabel="PT — Property Tax" />);
    fireEvent.change(screen.getByLabelText(/^Annual Interest Rate/), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText(/^Grace Days/), { target: { value: "15" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Penalty Rule" }));

    await waitFor(() => expect(screen.getByText("Create this penalty rule?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create penalty rule"));

    await waitFor(() => {
      expect(screen.getByText(/Penalty rule submitted/)).toBeInTheDocument();
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { annualRateBps: number; graceDays: number };
    expect(body.annualRateBps).toBe(1200); // 12% -> 1200 bps
    expect(body.graceDays).toBe(15);
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 422 }));

    render(<CreatePenaltyRuleForm rateHeadId="rh1" rateHeadLabel="PT — Property Tax" />);
    fireEvent.change(screen.getByLabelText(/^Annual Interest Rate/), { target: { value: "12" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Penalty Rule" }));

    await waitFor(() => expect(screen.getByText("Create this penalty rule?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create penalty rule"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 422/)).toBeInTheDocument();
    });
  });
});
