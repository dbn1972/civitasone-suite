/**
 * D4c #37: the checker verifies a bill's statutory deduction lines before advancing it: what the maker charged,
 * beside what the division rates computed, with adjusted lines flagged.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import { screen, fireEvent, waitFor } from "@testing-library/react";
import { renderWithIntl as render } from "@/lib/testUtils/intl";
import { BillDeductions } from "./BillDeductions";

const BILL = "44444444-4444-4444-4444-444444444444";

describe("BillDeductions", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("loads the lines only when a bill is opened, and flags an adjusted head", async () => {
    const spy = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [
      { id: "1", recoveryType: "gst_tds", amountMinor: "10000", computedAmountMinor: "20000", rateBps: 200, adjusted: true, remarks: null },
      { id: "2", recoveryType: "labour_cess", amountMinor: "10000", computedAmountMinor: "10000", rateBps: 100, adjusted: false, remarks: null },
    ] }), { status: 200 }));
    render(<BillDeductions bills={[{ id: BILL, billNo: "RA-01" }]} />);
    expect(spy).not.toHaveBeenCalled();
    fireEvent.click(screen.getByText(/RA-01/));
    await waitFor(() => expect(screen.getByText("GST TDS")).toBeInTheDocument());
    expect(String(spy.mock.calls[0]![0])).toBe(`/api/proxy/v1/works/billing/bills/${BILL}/recoveries`);
    expect(screen.getByText("Labour cess")).toBeInTheDocument();
    expect(screen.getAllByText(/adjusted/i)).toHaveLength(1);
  });

  it("says plainly when a bill has no deduction lines (distinct from a load failure)", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response(JSON.stringify({ data: [] }), { status: 200 }));
    render(<BillDeductions bills={[{ id: BILL, billNo: "RA-02" }]} />);
    fireEvent.click(screen.getByText(/RA-02/));
    expect(await screen.findByText(/no statutory deduction lines/i)).toBeInTheDocument();
  });

  it("shows a calm error, not the raw status, when the lines cannot be loaded", async () => {
    vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 500 }));
    render(<BillDeductions bills={[{ id: BILL, billNo: "RA-03" }]} />);
    fireEvent.click(screen.getByText(/RA-03/));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent(/couldn.t load/i);
    expect(alert.textContent).not.toMatch(/500/);
  });

  it("renders nothing when the work has no bills", () => {
    const { container } = render(<BillDeductions bills={[]} />);
    expect(container).toBeEmptyDOMElement();
  });
});
