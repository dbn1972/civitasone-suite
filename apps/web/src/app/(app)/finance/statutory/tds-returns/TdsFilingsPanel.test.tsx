import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));
import { TdsFilingsPanel } from "./TdsFilingsPanel";
import type { TdsFiling } from "./tdsFilings";

const q = (quarter: string, over: Partial<TdsFiling> = {}): TdsFiling => ({
  fy: "2026-27", quarter, formType: "26Q", dueDate: "2026-07-31", status: "pending", ackNo: null, filedOn: null, filedByName: null,
  deductionCount: 2, totalTdsMinor: "5000", undepositedCount: 0, ...over,
});
const FILINGS = [q("Q1", { status: "filed", ackNo: "ACK123456", filedOn: "2026-07-20", filedByName: "Asha Verma" }), q("Q2", { status: "overdue", undepositedCount: 1 })];

describe("TdsFilingsPanel (GAP-FINANCE-STATUTORY-TDS-RETURNS-04)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("shows the recorded acknowledgement and who recorded it, and offers Mark filed only for unfiled quarters", () => {
    render(<TdsFilingsPanel fy="2026-27" filings={FILINGS} canFile />);
    expect(screen.getByText("ACK123456")).toBeInTheDocument();
    expect(screen.getByText("Asha Verma")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Mark Q1 return filed" })).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Mark Q2 return filed" })).toBeInTheDocument();
  });

  it("offers no action to a read-only role", () => {
    render(<TdsFilingsPanel fy="2026-27" filings={FILINGS} canFile={false} />);
    expect(screen.queryByRole("button", { name: /Mark .* return filed/ })).not.toBeInTheDocument();
  });

  it("validates the acknowledgement number and date client-side, then posts and refreshes", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<TdsFilingsPanel fy="2026-27" filings={FILINGS} canFile />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Q2 return filed" }));
    expect(screen.getByText(/1 deduction is not yet marked deposited/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Record as filed" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/acknowledgement number/i);
    expect(fetchMock).not.toHaveBeenCalled();
    fireEvent.change(screen.getByLabelText("Acknowledgement number"), { target: { value: "ACK654321" } });
    fireEvent.change(screen.getByLabelText("Filed on"), { target: { value: "2026-09-30" } }); // not after the quarter end
    fireEvent.click(screen.getByRole("button", { name: "Record as filed" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/last day of its quarter/);
    fireEvent.change(screen.getByLabelText("Filed on"), { target: { value: "2026-10-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Record as filed" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/tds-returns/2026-27/Q2/file");
    expect(JSON.parse(String(init.body))).toEqual({ ackNo: "ACK654321", filedOn: "2026-10-02" });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("explains an already-filed conflict in plain language", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ code: "ALREADY_FILED" }), { status: 409 }));
    render(<TdsFilingsPanel fy="2026-27" filings={FILINGS} canFile />);
    fireEvent.click(screen.getByRole("button", { name: "Mark Q2 return filed" }));
    fireEvent.change(screen.getByLabelText("Acknowledgement number"), { target: { value: "ACK654321" } });
    fireEvent.change(screen.getByLabelText("Filed on"), { target: { value: "2026-10-02" } });
    fireEvent.click(screen.getByRole("button", { name: "Record as filed" }));
    const alert = await screen.findByRole("alert");
    expect(alert.textContent ?? "").not.toMatch(/409|ALREADY_FILED/);
    expect(refreshMock).not.toHaveBeenCalled();
  });
});
