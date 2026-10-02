import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import DepreciationRunPage from "./page";
import { periodError } from "./period";

describe("periodError (GAP-ASSETS-DEPRECIATION-02)", () => {
  it("accepts the current and past months, rejects future and malformed ones", () => {
    expect(periodError("2026-09", "2026-10")).toBeNull();
    expect(periodError("2026-10", "2026-10")).toBeNull();
    expect(periodError("2026-11", "2026-10")).toMatch(/in the future/);
    expect(periodError("2026-13", "2026-10")).toMatch(/Choose a period/);
    expect(periodError("", "2026-10")).toMatch(/Choose a period/);
  });
});

describe("DepreciationRunPage", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  it("disables submit with an inline error for a future month", () => {
    render(<DepreciationRunPage />);
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "2999-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/in the future/);
    expect(screen.getByRole("button", { name: "Run depreciation" })).toBeDisabled();
  });

  // GAP-ASSETS-DEPRECIATION-01
  it("says 'queued', never 'posted', after a 202", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ id: "run-1", status: "accepted" }), { status: 202 }),
    );
    render(<DepreciationRunPage />);
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "2026-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Run depreciation" }));
    await waitFor(() => expect(screen.getByText("Run period-end depreciation?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason / authorisation"), { target: { value: "Month-end close" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Run depreciation" }).at(-1)!);
    const status = await screen.findByRole("status");
    expect(status).toHaveTextContent(/queued/);
    expect(status).toHaveTextContent(/run-1/);
    expect(status.textContent).not.toMatch(/journals posted/);
  });

  // GAP-ASSETS-DEPRECIATION-04
  it("does not hard-code GL account numbers in the book labels or the dialog", async () => {
    render(<DepreciationRunPage />);
    expect(document.body.textContent).not.toMatch(/5100|5101/);
    fireEvent.change(screen.getByLabelText("Depreciation book"), { target: { value: "statutory" } });
    fireEvent.click(screen.getByRole("button", { name: "Run depreciation" }));
    await waitFor(() => expect(screen.getByText("Run period-end depreciation?")).toBeInTheDocument());
    expect(document.body.textContent).toMatch(/the statutory book \(WDV\)/);
    expect(document.body.textContent).not.toMatch(/5100|5101/);
  });

  // GAP-ASSETS-DEPRECIATION-05
  it("shows plain copy instead of the raw response body when the run fails", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response('{"code":"INTERNAL","message":"relation asset_assets does not exist"}', { status: 500 }));
    render(<DepreciationRunPage />);
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "2026-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Run depreciation" }));
    await waitFor(() => expect(screen.getByText("Run period-end depreciation?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason / authorisation"), { target: { value: "Month-end close" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Run depreciation" }).at(-1)!);
    await waitFor(() => expect(screen.getByText(/couldn't save/i)).toBeInTheDocument());
    expect(screen.queryByText(/relation asset_assets/)).not.toBeInTheDocument();
  });

  // GAP-ASSETS-DEPRECIATION-03 (default period is the IST month, validated)
  it("defaults the period to the IST month on the first hours of a month", () => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2026-03-31T20:00:00Z")); // 1 April 01:30 IST
    render(<DepreciationRunPage />);
    expect((screen.getByLabelText("Period") as HTMLInputElement).value).toBe("2026-04");
    vi.useRealTimers();
  });
});
