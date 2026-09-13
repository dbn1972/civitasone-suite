import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush, refresh: vi.fn() }),
}));

import TradeLicensesPage from "./page";
import type { TradeLicenseRow } from "./page";
import { feeRupees } from "./feeRupees";

// ---------------------------------------------------------------------------
// UX-018: feeMinor/feePaidMinor are typed as non-null strings, but the API can
// omit them. Unlike UX-006's Number(x)/100 masking bug, BigInt(null|undefined)
// THROWS — a crash risk, not just a masking risk. feeRupees() must guard the
// BigInt conversion so a missing fee renders "—" instead of crashing the row.
// ---------------------------------------------------------------------------
describe("feeRupees (UX-018: guards BigInt(), which throws on null/undefined)", () => {
  it("renders an em-dash for a missing fee instead of throwing", () => {
    expect(() => feeRupees(null)).not.toThrow();
    expect(() => feeRupees(undefined)).not.toThrow();
    expect(feeRupees(null)).toBe("—");
    expect(feeRupees(undefined)).toBe("—");
  });

  it("renders an em-dash for an empty string too", () => {
    expect(feeRupees("")).toBe("—");
  });

  it("still renders a genuine zero fee as 0, distinct from missing", () => {
    expect(feeRupees("0")).toBe("0");
    expect(feeRupees("0")).not.toBe(feeRupees(null));
  });

  it("truncates paise to whole rupees, matching the prior BigInt-division display", () => {
    expect(feeRupees("150050")).toBe("1500");
    expect(feeRupees("99")).toBe("0");
  });
});

describe("TradeLicensesTable — missing feeMinor/feePaidMinor row (UX-018)", () => {
  beforeEach(() => {
    vi.restoreAllMocks();
  });

  it("renders a row with a missing fee as an em-dash instead of crashing the whole table", async () => {
    const rows: TradeLicenseRow[] = [
      {
        id: "1",
        licenseNo: "TL-1",
        businessName: "Missing Fee Traders",
        proprietorName: "A. Proprietor",
        address: "1 MG Road",
        businessType: "retail",
        category: "A",
        status: "active",
        expiryDate: "2027-01-01",
        // Simulates the API omitting these despite the non-null string type.
        feeMinor: undefined as unknown as string,
        feePaidMinor: null as unknown as string,
        renewalCount: 0,
        isActive: true,
      },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: rows }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<TradeLicensesPage />);

    expect(await screen.findByText("Missing Fee Traders")).toBeInTheDocument();
    const dashes = await screen.findAllByText("—");
    // Exactly the Fee and Paid cells — expiryDate is set, so it doesn't also emit "—".
    expect(dashes).toHaveLength(2);
  });

  it("renders a row with a genuinely-zero fee as 0, not em-dash, and doesn't crash", async () => {
    const rows: TradeLicenseRow[] = [
      {
        id: "2",
        licenseNo: "TL-2",
        businessName: "Zero Fee Traders",
        proprietorName: "B. Proprietor",
        address: "2 MG Road",
        businessType: "service",
        category: "B",
        status: "active",
        expiryDate: "2027-02-02",
        feeMinor: "0",
        feePaidMinor: "0",
        renewalCount: 0,
        isActive: true,
      },
    ];
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ data: rows }), {
        status: 200,
        headers: { "content-type": "application/json" },
      }),
    );

    render(<TradeLicensesPage />);

    const row = (await screen.findByText("Zero Fee Traders")).closest("tr");
    expect(row).not.toBeNull();
    expect(row!.textContent).not.toMatch(/—/);
  });
});
