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
});
