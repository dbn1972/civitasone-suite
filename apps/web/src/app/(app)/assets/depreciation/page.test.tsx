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

const bookRow = (over: Record<string, unknown> = {}) => ({
  depBook: "company", pendingCount: 2, pendingMinor: "150000", postedCount: 0, postedMinor: "0", lastPostedAt: null, ...over,
});

/** URL-aware fetch mock: the status preview (GET) and the run (POST) answer independently. */
function mockApi(opts: { status?: unknown | "fail"; run?: Response } = {}) {
  return vi.spyOn(globalThis, "fetch").mockImplementation(async (url, init) => {
    const u = String(url);
    if (u.includes("/depreciation/status")) {
      return opts.status === "fail"
        ? new Response("{}", { status: 500 })
        : new Response(JSON.stringify(opts.status ?? { period: "2026-01", books: [bookRow()], lastPosted: null }), { status: 200 });
    }
    if ((init as RequestInit | undefined)?.method === "POST") return opts.run ?? new Response(JSON.stringify({ id: "run-1", status: "accepted" }), { status: 202 });
    return new Response("{}", { status: 404 });
  });
}

describe("DepreciationRunPage", () => {
  beforeEach(() => { vi.restoreAllMocks(); });

  // GAP-ASSETS-DEPRECIATION-02: last-run indicator, preview, already-posted
  it("shows the last posted period and a preview of what the run will post", async () => {
    mockApi({ status: { period: "2026-01", books: [bookRow(), bookRow({ depBook: "statutory", pendingCount: 1, pendingMinor: "50000" })], lastPosted: { period: "2025-12", postedAt: "2026-01-02T05:00:00.000Z" } } });
    render(<DepreciationRunPage />);
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "2026-01" } });
    const preview = await screen.findByTestId("dep-run-preview");
    await waitFor(() => expect(preview).toHaveTextContent(/Last posted period:\s*Dec 2025/));
    expect(preview).toHaveTextContent(/This run will post 3 entries totalling ₹2,000\.00 for Jan 2026/);
    expect(screen.getByRole("button", { name: "Run depreciation" })).toBeEnabled();
  });

  it("disables the run and says so when the period is already posted", async () => {
    mockApi({ status: { period: "2026-01", books: [bookRow({ pendingCount: 0, pendingMinor: "0", postedCount: 4, postedMinor: "400000" })], lastPosted: { period: "2026-01", postedAt: "2026-02-02T05:00:00.000Z" } } });
    render(<DepreciationRunPage />);
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "2026-01" } });
    expect(await screen.findByText(/Jan 2026 is already posted \(4 entries, ₹4,000\.00\)/)).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run depreciation" })).toBeDisabled();
  });

  it("says there is nothing scheduled when the period has no entries", async () => {
    mockApi({ status: { period: "2026-01", books: [], lastPosted: null } });
    render(<DepreciationRunPage />);
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "2026-01" } });
    expect(await screen.findByText(/No depreciation entries are scheduled for Jan 2026/)).toBeInTheDocument();
    expect(screen.getByText("No depreciation has been posted yet.")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run depreciation" })).toBeDisabled();
  });

  it("a failed preview is its own error state (not 'nothing to post') and does not block the run", async () => {
    mockApi({ status: "fail" });
    render(<DepreciationRunPage />);
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "2026-01" } });
    expect(await screen.findByText(/couldn't load/i)).toBeInTheDocument();
    expect(screen.queryByText(/nothing left to run/i)).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Run depreciation" })).toBeEnabled();
  });

  it("an ALREADY_POSTED reply from the service is shown as its own message, not a generic failure", async () => {
    mockApi({ run: new Response(JSON.stringify({ code: "ALREADY_POSTED", message: "depreciation for 2026-01 is already posted" }), { status: 409 }) });
    render(<DepreciationRunPage />);
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "2026-01" } });
    fireEvent.click(await screen.findByRole("button", { name: "Run depreciation" }));
    await waitFor(() => expect(screen.getByText("Run period-end depreciation?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason / authorisation"), { target: { value: "Month-end close" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Run depreciation" }).at(-1)!);
    expect(await screen.findByText(/already been posted\. Nothing was queued/)).toBeInTheDocument();
    expect(screen.queryByText(/ALREADY_POSTED/)).not.toBeInTheDocument();
  });

  it("disables submit with an inline error for a future month", () => {
    render(<DepreciationRunPage />);
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "2999-01" } });
    expect(screen.getByRole("alert")).toHaveTextContent(/in the future/);
    expect(screen.getByRole("button", { name: "Run depreciation" })).toBeDisabled();
  });

  // GAP-ASSETS-DEPRECIATION-01
  it("says 'queued', never 'posted', after a 202", async () => {
    mockApi();
    render(<DepreciationRunPage />);
    fireEvent.change(screen.getByLabelText("Period"), { target: { value: "2026-01" } });
    fireEvent.click(screen.getByRole("button", { name: "Run depreciation" }));
    await waitFor(() => expect(screen.getByText("Run period-end depreciation?")).toBeInTheDocument());
    fireEvent.change(screen.getByLabelText("Reason / authorisation"), { target: { value: "Month-end close" } });
    fireEvent.click(screen.getAllByRole("button", { name: "Run depreciation" }).at(-1)!);
    const status = await screen.findByText(/queued/);
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
    mockApi({ run: new Response('{"code":"INTERNAL","message":"relation asset_assets does not exist"}', { status: 500 }) });
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
