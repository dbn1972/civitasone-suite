import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const browserFetchMock = vi.fn();
vi.mock("@/lib/api/browserClient", () => ({
  browserFetch: (...args: unknown[]) => browserFetchMock(...args),
}));

import { ClosePeriodForm } from "./ClosePeriodForm";

function makeRes(ok: boolean, status: number, body: unknown): Response {
  return { ok, status, json: async () => body } as unknown as Response;
}

describe("ClosePeriodForm", () => {
  beforeEach(() => {
    refreshMock.mockReset();
    browserFetchMock.mockReset();
  });

  it("rejects an invalid month without opening the confirm dialog", () => {
    render(<ClosePeriodForm />);
    fireEvent.change(screen.getByLabelText(/Period/), { target: { value: "2026-13" } });
    fireEvent.click(screen.getByRole("button", { name: "Soft-Close Period" }));
    expect(screen.getByText(/valid month in YYYY-MM/)).toBeInTheDocument();
    expect(screen.queryByText("Soft-close this period?")).not.toBeInTheDocument();
    expect(browserFetchMock).not.toHaveBeenCalled();
  });

  it("soft-closes a valid period (happy path)", async () => {
    browserFetchMock.mockResolvedValue(makeRes(true, 200, { status: "soft_close" }));
    render(<ClosePeriodForm />);
    fireEvent.change(screen.getByLabelText(/Period/), { target: { value: "2026-04" } });
    fireEvent.click(screen.getByRole("button", { name: "Soft-Close Period" }));
    await waitFor(() => expect(screen.getByText("Soft-close this period?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Soft-close period"));
    await waitFor(() => expect(screen.getByText("Period 2026-04 soft-closed.")).toBeInTheDocument());
    expect(browserFetchMock).toHaveBeenCalledWith("v1/finance/periods/2026-04/close", { method: "POST" });
    expect(refreshMock).toHaveBeenCalled();
  });

  it("surfaces the server's code/message on a 409 (error path)", async () => {
    browserFetchMock.mockResolvedValue(
      makeRes(false, 409, { code: "ALREADY_CLOSED", message: "period is already hard-closed" }),
    );
    render(<ClosePeriodForm />);
    fireEvent.change(screen.getByLabelText(/Period/), { target: { value: "2026-03" } });
    fireEvent.click(screen.getByRole("button", { name: "Soft-Close Period" }));
    await waitFor(() => expect(screen.getByText("Soft-close this period?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Soft-close period"));
    await waitFor(() =>
      expect(screen.getByText(/ALREADY_CLOSED: period is already hard-closed/)).toBeInTheDocument(),
    );
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
