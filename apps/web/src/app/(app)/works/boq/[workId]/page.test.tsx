import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ refresh: vi.fn() }),
}));

import BoqDetailPage from "./page";

const WORK = "11111111-1111-1111-1111-111111111111";

/** Dispatch by URL so call order never matters: recap URL -> recap, else items. */
function mockResults(items: unknown, recap: unknown) {
  fetchJsonMock.mockReset();
  notFoundMock.mockClear();
  fetchJsonMock.mockImplementation(async (url: string) =>
    String(url).includes("/recapitulation") ? recap : items,
  );
}

describe("BoqDetailPage", () => {
  it("GAP-WORKS-BOQ-WORKID-02: an items error (non-404) shows a retry error state, NOT the empty 'No BoQ items'", async () => {
    mockResults(
      { data: [], source: "error", status: 500 },
      { data: null, source: "error", status: 500 },
    );
    const ui = await BoqDetailPage({ params: { workId: WORK } });
    render(ui);
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByText(/couldn't load the BoQ items/i)).toBeInTheDocument();
    expect(screen.queryByText("No BoQ items")).not.toBeInTheDocument();
  });

  it("GAP-WORKS-BOQ-WORKID-02: a 404 on items calls notFound()", async () => {
    mockResults(
      { data: [], source: "error", status: 404 },
      { data: null, source: "error", status: 404 },
    );
    await expect(BoqDetailPage({ params: { workId: WORK } })).rejects.toThrow("NEXT_NOT_FOUND");
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("GAP-WORKS-BOQ-WORKID-01: renders the recap breakdown with per-component basis, rate % and amount", async () => {
    mockResults(
      { data: [{ id: "i1", workId: WORK, itemDescription: "PCC", itemCode: "SR-1", unit: "cum", rate: "12500", quantity: "2", amountMinor: "2500000", scopeId: "", srItemId: "" }], source: "api" },
      {
        data: {
          workAmount: "10000000", grandTotal: "11500000",
          contingencyPercent: "3", turnoverTaxPercent: "0", workChargePercent: "1",
          qualityControlPercent: "0.5", centagePercent: "10", otherCharges: "50000",
          breakdown: [
            { key: "workAmount", label: "Work Amount", basis: "flat", ratePercent: null, amountMinor: "10000000" },
            { key: "contingency", label: "Contingency", basis: "work_amount", ratePercent: 3, amountMinor: "300000" },
            { key: "centage", label: "Centage", basis: "work_amount", ratePercent: 10, amountMinor: "1000000" },
            { key: "otherCharges", label: "Other Charges", basis: "flat", ratePercent: null, amountMinor: "50000" },
          ],
        },
        source: "api",
      },
    );
    const ui = await BoqDetailPage({ params: { workId: WORK } });
    render(ui);
    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByText("Contingency")).toBeInTheDocument();
    expect(screen.getAllByText("% of Work Amount").length).toBeGreaterThan(0);
    // rate % and the paise amount for the contingency line
    expect(screen.getByText("₹3,000.00")).toBeInTheDocument(); // 300000 paise = 3% of ₹1,00,000
    // Grand total appears both as the stat card and the recap total row.
    expect(screen.getAllByText("₹1,15,000.00").length).toBeGreaterThanOrEqual(1);
  });

  it("GAP-WORKS-BOQ-WORKID-03: fallback total sums paise with BigInt when recap is unavailable", async () => {
    mockResults(
      { data: [
        { id: "i1", workId: WORK, itemDescription: "A", itemCode: "—", unit: "cum", rate: "100", quantity: "1", amountMinor: "9007199254740993", scopeId: "", srItemId: "" },
        { id: "i2", workId: WORK, itemDescription: "B", itemCode: "—", unit: "cum", rate: "100", quantity: "1", amountMinor: "1", scopeId: "", srItemId: "" },
      ], source: "api" },
      { data: null, source: "error", status: 404 }, // no recap computed yet
    );
    const ui = await BoqDetailPage({ params: { workId: WORK } });
    render(ui);
    expect(notFoundMock).not.toHaveBeenCalled();
    // 9007199254740993 + 1 = 9007199254740994 paise -> exact only via BigInt.
    expect(screen.getByText("₹9,00,71,99,25,47,409.94")).toBeInTheDocument();
    expect(screen.getByText("Sum of items")).toBeInTheDocument();
  });
});
