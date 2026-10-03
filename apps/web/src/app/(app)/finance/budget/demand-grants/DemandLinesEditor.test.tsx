import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));
import { DemandLinesEditor } from "./DemandLinesEditor";

const HEADS = [{ code: "2202", name: "General Education" }, { code: "2203", name: "Technical Education" }];

describe("DemandLinesEditor (GAP-FINANCE-BUDGET-DEMAND-GRANTS-04)", () => {
  beforeEach(() => { vi.restoreAllMocks(); refreshMock.mockReset(); });

  it("refuses to save a split that does not total the demand, with the running total shown", () => {
    const fetchMock = vi.spyOn(globalThis, "fetch");
    render(<DemandLinesEditor demandId="d1" demandAmountMinor="100000" lines={[]} heads={HEADS} />);
    fireEvent.change(screen.getByLabelText("Major head, row 1"), { target: { value: "2202" } });
    fireEvent.change(screen.getByLabelText("Amount in rupees, row 1"), { target: { value: "400" } });
    expect(screen.getByText(/Total ₹400\.00 of ₹1,000\.00/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Save head-wise lines" }));
    expect(screen.getByRole("alert")).toHaveTextContent("The head-wise amounts must add up to the demand amount.");
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("PUTs a split that totals the demand, in paise, with an idempotency key", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(new Response("{}", { status: 202 }));
    render(<DemandLinesEditor demandId="d1" demandAmountMinor="100000" lines={[]} heads={HEADS} />);
    fireEvent.change(screen.getByLabelText("Major head, row 1"), { target: { value: "2202" } });
    fireEvent.change(screen.getByLabelText("Amount in rupees, row 1"), { target: { value: "600" } });
    fireEvent.click(screen.getByRole("button", { name: "Add head" }));
    fireEvent.change(screen.getByLabelText("Major head, row 2"), { target: { value: "2203" } });
    fireEvent.change(screen.getByLabelText("Amount in rupees, row 2"), { target: { value: "400.00" } });
    fireEvent.click(screen.getByRole("button", { name: "Save head-wise lines" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("/api/proxy/v1/finance/budgets/demand-grants/d1/lines");
    expect(init.method).toBe("PUT");
    expect((init.headers as Record<string, string>)["x-idempotency-key"]).toMatch(/^[0-9a-f-]{36}$/);
    expect(JSON.parse(String(init.body))).toEqual({ lines: [{ headCode: "2202", amountMinor: "60000" }, { headCode: "2203", amountMinor: "40000" }] });
    await waitFor(() => expect(refreshMock).toHaveBeenCalled());
  });

  it("starts from the existing lines", () => {
    render(<DemandLinesEditor demandId="d1" demandAmountMinor="100000" lines={[{ id: "l1", headCode: "2202", headName: "General Education", amountMinor: "100000" }]} heads={HEADS} />);
    expect((screen.getByLabelText("Major head, row 1") as HTMLSelectElement).value).toBe("2202");
    expect((screen.getByLabelText("Amount in rupees, row 1") as HTMLInputElement).value).toBe("1000.00");
  });
});
