import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

import { PeriodsTable, type PeriodRow } from "./PeriodsTable";

const OPEN: PeriodRow = { period: "2026-05", fiscalYear: "2026-27", status: "open", closedBy: null, closedAt: null };
const SOFT: PeriodRow = {
  period: "2026-04",
  fiscalYear: "2026-27",
  status: "soft_close",
  closedBy: "11111111-1111-1111-1111-111111111111",
  closedAt: "2026-05-02T00:00:00.000Z",
};
const HARD: PeriodRow = {
  period: "2026-03",
  fiscalYear: "2026-27",
  status: "hard_close",
  closedBy: "11111111-1111-1111-1111-111111111111",
  closedAt: "2026-04-05T00:00:00.000Z",
};

describe("PeriodsTable", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
    refreshMock.mockReset();
  });

  it("renders the periods list", () => {
    render(<PeriodsTable periods={[OPEN, SOFT, HARD]} canReopen />);
    expect(screen.getByText("2026-05")).toBeInTheDocument();
    expect(screen.getByText("2026-04")).toBeInTheDocument();
    expect(screen.getByText("2026-03")).toBeInTheDocument();
  });

  it("shows the guided empty state when there are no periods", () => {
    render(<PeriodsTable periods={[]} canReopen />);
    expect(screen.getByText("No periods tracked yet")).toBeInTheDocument();
  });

  it("only offers valid transitions per period status, with distinct accessible names", () => {
    render(<PeriodsTable periods={[OPEN, SOFT, HARD]} canReopen />);

    // open: soft-close + hard-close, no reopen
    expect(screen.getByRole("button", { name: "Soft-close period 2026-05" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Hard-close period 2026-05" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reopen period 2026-05" })).not.toBeInTheDocument();

    // soft_close: hard-close + reopen, no soft-close
    expect(screen.getByRole("button", { name: "Hard-close period 2026-04" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Reopen period 2026-04" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Soft-close period 2026-04" })).not.toBeInTheDocument();

    // hard_close: only reopen
    expect(screen.getByRole("button", { name: "Reopen period 2026-03" })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Soft-close period 2026-03" })).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Hard-close period 2026-03" })).not.toBeInTheDocument();
  });

  it("applies a hard-close on confirm (happy path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: { period: "2026-05", status: "hard_close" } }), { status: 200 }),
    );

    render(<PeriodsTable periods={[OPEN]} canReopen />);
    fireEvent.click(screen.getByRole("button", { name: "Hard-close period 2026-05" }));

    await waitFor(() => expect(screen.getByText("Hard-close period 2026-05?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Hard-close" }));

    await waitFor(() => {
      expect(screen.getByText("Period 2026-05: hard-close applied.")).toBeInTheDocument();
    });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces a 409 server error code on the confirm dialog (error path)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ code: "ALREADY_CLOSED", message: "period is already hard-closed" }), {
        status: 409,
      }),
    );

    render(<PeriodsTable periods={[SOFT]} canReopen />);
    fireEvent.click(screen.getByRole("button", { name: "Hard-close period 2026-04" }));

    await waitFor(() => expect(screen.getByText("Hard-close period 2026-04?")).toBeInTheDocument());
    fireEvent.click(screen.getByRole("button", { name: "Hard-close" }));

    await waitFor(() => {
      expect(screen.getByText(/ALREADY_CLOSED: period is already hard-closed/)).toBeInTheDocument();
    });
  });

  it("requires a reason before allowing a reopen to be confirmed", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: {} }), { status: 200 }));

    render(<PeriodsTable periods={[HARD]} canReopen />);
    fireEvent.click(screen.getByRole("button", { name: "Reopen period 2026-03" }));

    await waitFor(() => expect(screen.getByText("Reopen period 2026-03?")).toBeInTheDocument());
    const confirmBtn = screen.getByRole("button", { name: "Reopen" });
    expect(confirmBtn).toBeDisabled();

    fireEvent.change(screen.getByLabelText("Reason for reopening"), { target: { value: "Correcting a posting error" } });
    expect(confirmBtn).not.toBeDisabled();
  });

  it("hides Reopen for non-admin roles (canReopen=false)", () => {
    render(<PeriodsTable periods={[SOFT, HARD]} canReopen={false} />);
    expect(screen.queryByRole("button", { name: /^Reopen/ })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: /^Hard-close/ })).toBeInTheDocument();
  });
});
