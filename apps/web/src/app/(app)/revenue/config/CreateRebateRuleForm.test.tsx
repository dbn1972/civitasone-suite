import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateRebateRuleForm } from "./CreateRebateRuleForm";

describe("CreateRebateRuleForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a discount percent before opening the confirm dialog", () => {
    render(<CreateRebateRuleForm rateHeadId="rh1" rateHeadLabel="PT — Property Tax" />);
    fireEvent.click(screen.getByText("Create Rebate Rule"));
    expect(screen.getByText(/Discount \(%\) is required/)).toBeInTheDocument();
  });

  it("converts the discount percent to basis points and creates the rule on confirm (happy path)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "r-1", status: "accepted" }), { status: 202 }));

    render(<CreateRebateRuleForm rateHeadId="rh1" rateHeadLabel="PT — Property Tax" />);
    fireEvent.change(screen.getByLabelText(/^Discount/), { target: { value: "5" } });
    fireEvent.change(screen.getByLabelText(/^Valid Until/), { target: { value: "30" } });
    fireEvent.click(screen.getByText("Create Rebate Rule"));

    await waitFor(() => expect(screen.getByText("Create this rebate rule?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create rebate rule"));

    await waitFor(() => {
      expect(screen.getByText(/Rebate rule submitted/)).toBeInTheDocument();
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { discountBps: number; validUntilDaysBeforeDue: number };
    expect(body.discountBps).toBe(500); // 5% -> 500 bps
    expect(body.validUntilDaysBeforeDue).toBe(30);
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a server error on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 500 }));

    render(<CreateRebateRuleForm rateHeadId="rh1" rateHeadLabel="PT — Property Tax" />);
    fireEvent.change(screen.getByLabelText(/^Discount/), { target: { value: "5" } });
    fireEvent.click(screen.getByText("Create Rebate Rule"));

    await waitFor(() => expect(screen.getByText("Create this rebate rule?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create rebate rule"));

    await waitFor(() => {
      expect(screen.getByText(/API_ERROR: 500/)).toBeInTheDocument();
    });
  });
});
