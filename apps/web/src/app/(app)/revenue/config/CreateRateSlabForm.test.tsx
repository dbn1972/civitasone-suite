import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { CreateRateSlabForm } from "./CreateRateSlabForm";

describe("CreateRateSlabForm", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("requires a rate and an effective-from date before opening the confirm dialog", () => {
    render(<CreateRateSlabForm rateHeadId="rh1" rateHeadLabel="PT — Property Tax" />);
    fireEvent.click(screen.getByRole("button", { name: "Create Rate Slab" }));
    expect(screen.getByText(/Rate \(₹\) is required/)).toBeInTheDocument();
  });

  it("converts a percent input to basis points for an ad_valorem slab and creates it on confirm (happy path)", async () => {
    const fetchSpy = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValue(new Response(JSON.stringify({ id: "s-1", status: "accepted" }), { status: 202 }));

    render(<CreateRateSlabForm rateHeadId="rh1" rateHeadLabel="PT — Property Tax" />);
    fireEvent.change(screen.getByLabelText(/^Slab Type/), { target: { value: "ad_valorem" } });
    fireEvent.change(screen.getByLabelText(/^Rate \(%\)/), { target: { value: "12" } });
    fireEvent.change(screen.getByLabelText(/^Effective From/), { target: { value: "2026-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Rate Slab" }));

    await waitFor(() => expect(screen.getByText("Create this rate slab?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create rate slab"));

    await waitFor(() => {
      expect(screen.getByText(/Rate slab submitted/)).toBeInTheDocument();
    });

    const [, init] = fetchSpy.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string) as { rateValue: string; slabType: string };
    expect(body.slabType).toBe("ad_valorem");
    expect(body.rateValue).toBe("1200"); // 12% -> 1200 bps, never double-divided
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a clerk-safe error on the confirm dialog, never the server's raw code/message (error path, UX-020)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(null, { status: 400 }));

    render(<CreateRateSlabForm rateHeadId="rh1" rateHeadLabel="PT — Property Tax" />);
    fireEvent.change(screen.getByLabelText(/^Rate \(₹\)/), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/^Effective From/), { target: { value: "2026-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Rate Slab" }));

    await waitFor(() => expect(screen.getByText("Create this rate slab?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Create rate slab"));

    await waitFor(() => {
      expect(screen.getByText(/Some details weren't accepted\. Check what you entered and try again\./)).toBeInTheDocument();
    });
    expect(screen.queryByText(/API_ERROR: 400/)).not.toBeInTheDocument();
  });

  it("rejects a band whose Band To is not greater than Band From (GAP-REVENUE-CONFIG-04)", () => {
    render(<CreateRateSlabForm rateHeadId="rh1" rateHeadLabel="PT — Property Tax" />);
    fireEvent.change(screen.getByLabelText(/^Slab Type/), { target: { value: "band" } });
    fireEvent.change(screen.getByLabelText(/^Band From/), { target: { value: "200" } });
    fireEvent.change(screen.getByLabelText(/^Band To/), { target: { value: "100" } });
    fireEvent.change(screen.getByLabelText(/^Rate \(₹\)/), { target: { value: "50" } });
    fireEvent.change(screen.getByLabelText(/^Effective From/), { target: { value: "2026-04-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Create Rate Slab" }));

    expect(screen.getByText(/Band To \(₹\) must be greater than Band From/)).toBeInTheDocument();
    expect(screen.queryByText("Create this rate slab?")).not.toBeInTheDocument();
  });
});
