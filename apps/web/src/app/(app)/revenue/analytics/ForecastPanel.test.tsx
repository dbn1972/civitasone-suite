import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { ForecastPanel } from "./ForecastPanel";

describe("ForecastPanel", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("validates horizon before submitting", () => {
    render(<ForecastPanel defaultGranularity="month" />);
    fireEvent.change(screen.getByLabelText(/Horizon/), { target: { value: "0" } });
    fireEvent.click(screen.getByRole("button", { name: "Run Forecast" }));
    expect(screen.getByText(/Horizon must be a whole number/)).toBeInTheDocument();
  });

  it("runs a forecast and renders projections (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(
        JSON.stringify({
          data: {
            method: "moving_average",
            historyPeriods: 6,
            horizon: 3,
            madMinor: "1200",
            confidenceBps: 8500,
            projections: [{ index: 1, projectionMinor: "50000", lowerMinor: "45000", upperMinor: "55000" }],
            granularity: "month",
            param: 3,
            series: ["48000", "49000", "50000"],
          },
        }),
        { status: 200 },
      ),
    );

    render(<ForecastPanel defaultGranularity="month" />);
    fireEvent.click(screen.getByRole("button", { name: "Run Forecast" }));

    await waitFor(() => {
      expect(screen.getByText(/Method/)).toBeInTheDocument();
    });
    expect(screen.getByText(/moving average/)).toBeInTheDocument();
  });

  it("surfaces a server error (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ error: { code: "VALIDATION_FAILED", message: "bad request" } }), { status: 400 }),
    );

    render(<ForecastPanel defaultGranularity="month" />);
    fireEvent.click(screen.getByRole("button", { name: "Run Forecast" }));

    await waitFor(() => {
      expect(screen.getByText(/VALIDATION_FAILED: bad request/)).toBeInTheDocument();
    });
  });
});
