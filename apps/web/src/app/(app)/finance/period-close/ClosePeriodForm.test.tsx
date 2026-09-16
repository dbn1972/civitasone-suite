import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: refreshMock }),
}));

const browserFetchMock = vi.fn();
// Keep the real errorMessageFromResponse (it never reads the response body or
// makes a network call -- see its own doc comment -- so it's safe and correct
// to exercise for real here) while only mocking the network-making
// browserFetch.
vi.mock("@/lib/api/browserClient", async () => {
  const actual = await vi.importActual<typeof import("@/lib/api/browserClient")>("@/lib/api/browserClient");
  return {
    ...actual,
    browserFetch: (...args: unknown[]) => browserFetchMock(...args),
  };
});

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

  // UX-016: this used to assert the raw backend `code`/`message`
  // ("ALREADY_CLOSED: period is already hard-closed") was echoed verbatim on
  // the confirm dialog -- the same class of leak useFormError/toHumanError
  // closes fleet-wide (UX-003); this specific site relied on PeriodsTable's
  // now-removed `parseErrorMessage` export, so the static guard never
  // flagged it directly even though it was a live leak. The clerk-safe
  // replacement never shows backend-authored text or the status code, so
  // this now asserts a catalogued message instead, and explicitly that the
  // raw text is absent.
  it("shows a clerk-safe error on a 409 (error path)", async () => {
    browserFetchMock.mockResolvedValue(
      makeRes(false, 409, { code: "ALREADY_CLOSED", message: "period is already hard-closed" }),
    );
    render(<ClosePeriodForm />);
    fireEvent.change(screen.getByLabelText(/Period/), { target: { value: "2026-03" } });
    fireEvent.click(screen.getByRole("button", { name: "Soft-Close Period" }));
    await waitFor(() => expect(screen.getByText("Soft-close this period?")).toBeInTheDocument());
    fireEvent.click(screen.getByText("Soft-close period"));

    const alert = await screen.findByRole("alert");
    await waitFor(() => expect(alert).toHaveTextContent(/couldn't save/i));
    expect(alert.textContent).not.toMatch(/ALREADY_CLOSED/);
    expect(alert.textContent).not.toMatch(/period is already hard-closed/);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
