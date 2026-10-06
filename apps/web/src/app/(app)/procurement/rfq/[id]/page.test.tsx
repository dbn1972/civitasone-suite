import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "../../../../_components/ds";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", async () => {
  const actual = await vi.importActual<typeof import("@/app/_data/apiClient")>("@/app/_data/apiClient");
  return { ...actual, fetchJson: (...args: unknown[]) => fetchJsonMock(...args) };
});
// RFQActions reads the session for role-gated display; give it a procurement role.
vi.mock("@/lib/auth/useSessionIdentity", () => ({
  useSessionIdentity: () => ({ loaded: true, userId: "approver", roles: ["procurement_officer"] }),
}));
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }) }));

import RFQDetailPage from "./page";
import type { RFQDetail } from "@civitasone/types";

function route(rfq: RFQDetail | null, source: "api" | "error" = "api") {
  fetchJsonMock.mockImplementation((_path: unknown, empty: unknown, options?: { mapResponse?: (p: unknown) => unknown }) => {
    const mapped = options?.mapResponse ? options.mapResponse(rfq) : rfq;
    return Promise.resolve({ data: source === "error" ? empty : mapped, source });
  });
}

async function renderPage(id: string) {
  const el = await RFQDetailPage({ params: { id } });
  return render(<ToastProvider>{el}</ToastProvider>);
}

const CLOSED: RFQDetail = {
  id: "r1", rfqNo: "RFQ/2026/001", title: "Laptops",
  indentRef: "procurement_indent:ind-9", vendorsInvited: 3, responsesReceived: 2,
  closingDate: "2000-01-01", status: "closed",
  description: "Line one\nLine two",
  awardedResponseId: null,
  lineItems: [{ itemId: "li1", itemName: "Laptop", quantity: 10, unit: "nos" }],
  responses: [
    { vendorId: "v1", vendorName: "Acme", responseId: "resp-1", totalAmountMinor: "5000000", sealed: false, lineRates: [{ itemId: "li1", unitPriceMinor: "500000" }], submittedAt: "2026-01-10T06:00:00.000Z", status: "submitted" },
    { vendorId: "v2", vendorName: "Beta", responseId: "resp-2", totalAmountMinor: "4200000", sealed: false, lineRates: [{ itemId: "li1", unitPriceMinor: "420000" }], submittedAt: "2026-01-11T06:00:00.000Z", status: "submitted" },
  ],
};

describe("RFQDetailPage (GAP-PROCUREMENT-RFQ-DETAIL-01/02/03/04/05)", () => {
  beforeEach(() => fetchJsonMock.mockReset());

  it("DETAIL-04: indent ref renders a link to the indent, never the raw ref", async () => {
    route(CLOSED);
    await renderPage("r1");
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs).toContain("/procurement/indents/ind-9");
    expect(screen.queryByText(/procurement_indent:/)).not.toBeInTheDocument();
  });

  it("DETAIL-04: a malformed ':undefined' indent ref shows '—' and no link", async () => {
    route({ ...CLOSED, indentRef: "procurement_indent:undefined" });
    await renderPage("r1");
    const hrefs = Array.from(document.querySelectorAll("a")).map((a) => a.getAttribute("href"));
    expect(hrefs.some((h) => h?.startsWith("/procurement/indents/"))).toBe(false);
  });

  it("DETAIL-02: the lowest responsive quote is marked L1", async () => {
    route(CLOSED);
    await renderPage("r1");
    // Beta (42,000) is lower than Acme (50,000) -> L1 on Beta's row.
    const l1 = screen.getByText("L1");
    const row = l1.closest("tr")!;
    expect(row.textContent).toContain("Beta");
  });

  it("DETAIL-02: a per-line rate matrix is shown when rates are present", async () => {
    route(CLOSED);
    await renderPage("r1");
    expect(screen.getByText("₹5,000.00")).toBeInTheDocument(); // Acme's per-line rate
    expect(screen.getByText("₹4,200.00")).toBeInTheDocument(); // Beta's per-line rate
  });

  it("DETAIL-03: a still-open RFQ with sealed responses shows 'Sealed', not an amount", async () => {
    route({
      ...CLOSED,
      status: "issued",
      closingDate: "2999-12-31",
      responses: [
        { vendorId: "v1", vendorName: "Acme", responseId: "resp-1", totalAmountMinor: undefined, sealed: true, lineRates: [], submittedAt: "2026-01-10T06:00:00.000Z", status: "submitted" },
      ],
    });
    await renderPage("r1");
    expect(screen.getByText("Sealed")).toBeInTheDocument();
    expect(screen.queryByText("L1")).not.toBeInTheDocument();
  });

  it("DETAIL-05: submitted timestamp shows IST date AND time", async () => {
    route(CLOSED);
    await renderPage("r1");
    // 2026-01-10T06:00:00Z -> 11:30 am IST on 10 Jan 2026
    expect(screen.getByText(/10 Jan 2026,.*11:30/)).toBeInTheDocument();
  });

  it("DETAIL-05: a multi-line description preserves line breaks (pre-wrap)", async () => {
    route(CLOSED);
    await renderPage("r1");
    const desc = screen.getByText(/Line one/);
    expect(getComputedStyle(desc).whiteSpace).toBe("pre-wrap");
  });

  it("DETAIL-01: a closed RFQ past closing offers an Award action to a procurement officer", async () => {
    route(CLOSED);
    await renderPage("r1");
    // Award targets the L1 vendor (Beta).
    expect(screen.getByRole("button", { name: /Award to Beta/ })).toBeInTheDocument();
  });

  it("DETAIL-01: an issued RFQ offers a Close action", async () => {
    route({ ...CLOSED, status: "issued", closingDate: "2999-12-31", responses: [] });
    await renderPage("r1");
    expect(screen.getByRole("button", { name: "Close RFQ" })).toBeInTheDocument();
  });
});
