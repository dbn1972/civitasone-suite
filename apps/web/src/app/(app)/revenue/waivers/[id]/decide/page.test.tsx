import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));

const getSessionUserIdMock = vi.fn<() => string | null>(() => "checker-1");
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionUserId: () => getSessionUserIdMock(),
}));

import WaiverDecidePage from "./page";

const WAIVER_ID = "3fa85f64-5717-4562-b3fc-2c963f66afa6";

function makeWaiver(partial: Record<string, unknown> = {}) {
  return {
    id: WAIVER_ID,
    demandId: "d1111111-1111-1111-1111-111111111111",
    amountMinor: "25000",
    reason: "Hardship",
    status: "pending",
    requestedBy: "maker-1",
    createdAt: "2026-03-10T00:00:00.000Z",
    ...partial,
  };
}

describe("WaiverDecidePage (GAP-REVENUE-WAIVERS-03)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionUserIdMock.mockReturnValue("checker-1");
  });

  it("renders amount, reason and status; enables decide for a different officer", async () => {
    fetchJsonMock.mockResolvedValue({ data: makeWaiver(), source: "api" });
    const ui = await WaiverDecidePage({ params: { id: WAIVER_ID } });
    render(ui);
    expect(screen.getByText("₹250.00")).toBeInTheDocument();
    expect(screen.getByText("Hardship")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /Approve waiver/ })).toBeEnabled();
  });

  it("disables decide when the signed-in user raised the waiver (maker != checker)", async () => {
    getSessionUserIdMock.mockReturnValue("maker-1");
    fetchJsonMock.mockResolvedValue({ data: makeWaiver({ requestedBy: "maker-1" }), source: "api" });
    const ui = await WaiverDecidePage({ params: { id: WAIVER_ID } });
    render(ui);
    expect(screen.getByRole("button", { name: /Approve waiver/ })).toBeDisabled();
    expect(screen.getByText(/you raised this waiver/i)).toBeInTheDocument();
  });

  it("hides decide for an already-decided waiver", async () => {
    fetchJsonMock.mockResolvedValue({ data: makeWaiver({ status: "approved" }), source: "api" });
    const ui = await WaiverDecidePage({ params: { id: WAIVER_ID } });
    render(ui);
    expect(screen.queryByRole("button", { name: /Approve waiver/ })).not.toBeInTheDocument();
    expect(screen.getByText(/Already decided/)).toBeInTheDocument();
  });

  it("calls notFound() on a 404", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 404 });
    await expect(WaiverDecidePage({ params: { id: WAIVER_ID } })).rejects.toThrow("NEXT_NOT_FOUND");
  });

  it("shows a retry state (buttons disabled) on a server error", async () => {
    fetchJsonMock.mockResolvedValue({ data: null, source: "error", status: 500 });
    const ui = await WaiverDecidePage({ params: { id: WAIVER_ID } });
    render(ui);
    expect(screen.getByRole("button", { name: /Approve waiver/ })).toBeDisabled();
    expect(screen.queryByText(/₹/)).not.toBeInTheDocument();
  });
});
