import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { ToastProvider } from "@/app/_components/ds/Toast";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const notFoundMock = vi.fn(() => {
  throw new Error("NEXT_NOT_FOUND");
});
vi.mock("next/navigation", () => ({
  notFound: () => notFoundMock(),
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
}));

// Session roles come from the JWT cookie via next/headers; stub them so the
// (server) detail page can compute canDaoFinalize/canDoFinalize in jsdom.
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => ["works_admin"],
  hasAnyRole: (roles: string[], allowed: string[]) => allowed.some((r) => roles.includes(r)),
}));

import TenderDetailPage from "./page";

// quotations result is fetched first, then the single tender by id.
function mockFetches(
  quotations: { data: unknown[]; source: string },
  tender: { data: unknown | null; source: string },
) {
  fetchJsonMock.mockResolvedValueOnce(quotations).mockResolvedValueOnce(tender);
}

describe("TenderDetailPage — reachability (L1)", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    notFoundMock.mockClear();
  });

  it("404s a bogus tender id instead of rendering a shell for a non-existent tender", async () => {
    mockFetches(
      { data: [], source: "api" },
      { data: null, source: "api" },
    );

    await expect(TenderDetailPage({ params: Promise.resolve({ id: "does-not-exist" }) })).rejects.toThrow(
      "NEXT_NOT_FOUND",
    );
    expect(notFoundMock).toHaveBeenCalled();
  });

  it("renders the detail for a real tender id (no 404)", async () => {
    mockFetches(
      { data: [], source: "api" },
      {
        data: {
          id: "t-valid",
          workId: "w1",
          workNumber: "WRK-2026-001",
          tenderType: "open",
          tenderCategory: "civil",
          status: "open",
        },
        source: "api",
      },
    );

    const ui = await TenderDetailPage({ params: Promise.resolve({ id: "t-valid" }) });
    render(<ToastProvider>{ui}</ToastProvider>);

    expect(notFoundMock).not.toHaveBeenCalled();
    expect(screen.getByText("Tender — WRK-2026-001")).toBeInTheDocument();
  });

  it("exposes a #quotations anchor the Awarded stat links to (GAP-WORKS-TENDERS-05)", async () => {
    mockFetches(
      { data: [], source: "api" },
      {
        data: { id: "t-valid", workId: "w1", workNumber: "WRK-2026-001", tenderType: "open", status: "open" },
        source: "api",
      },
    );
    const ui = await TenderDetailPage({ params: Promise.resolve({ id: "t-valid" }) });
    const { container } = render(<ToastProvider>{ui}</ToastProvider>);
    expect(container.querySelector("#quotations")).not.toBeNull();
    const awarded = screen.getByText("Awarded").closest("a");
    expect(awarded).toHaveAttribute("href", "#quotations");
  });

  it("does NOT 404 when the by-id read fails (transient error, not a missing record)", async () => {
    mockFetches(
      { data: [], source: "error" },
      { data: null, source: "error" },
    );

    const ui = await TenderDetailPage({ params: Promise.resolve({ id: "anything" }) });
    render(<ToastProvider>{ui}</ToastProvider>);
    expect(notFoundMock).not.toHaveBeenCalled();
  });

  it("offers Issue MB prefilled with workId and awardId once an award exists (BILLING-NEW-MB-01)", async () => {
    const W = "11111111-1111-4111-8111-111111111111";
    const A = "22222222-2222-4222-8222-222222222222";
    mockFetches(
      { data: [{ id: "q1", tenderId: "t-valid", contractorId: null, contractorName: "ACME", method: "item_rate", quotedAmountMinor: "100", quotedPercentage: null, deviationPercent: null, status: "awarded", submittedAt: null, awardId: A }], source: "api" },
      { data: { id: "t-valid", workId: W, workNumber: "WRK-1", tenderType: "open", status: "open" }, source: "api" },
    );
    const ui = await TenderDetailPage({ params: Promise.resolve({ id: "t-valid" }) });
    render(<ToastProvider>{ui}</ToastProvider>);
    expect(screen.getByRole("link", { name: "Issue MB" })).toHaveAttribute(
      "href",
      `/works/billing/new-mb?workId=${W}&awardId=${A}`,
    );
  });

  it("shows no Issue MB link before any award exists", async () => {
    mockFetches(
      { data: [], source: "api" },
      { data: { id: "t-valid", workId: "11111111-1111-4111-8111-111111111111", workNumber: "WRK-1", status: "open" }, source: "api" },
    );
    const ui = await TenderDetailPage({ params: Promise.resolve({ id: "t-valid" }) });
    render(<ToastProvider>{ui}</ToastProvider>);
    expect(screen.queryByRole("link", { name: "Issue MB" })).not.toBeInTheDocument();
  });

  const quot = (o: Record<string, unknown>) => ({
    id: "q-" + Math.random().toString(16).slice(2, 10),
    tenderId: "t-valid",
    contractorId: null,
    contractorName: "ACME",
    method: "item_rate",
    quotedAmountMinor: null,
    quotedPercentage: null,
    deviationPercent: null,
    status: "submitted",
    submittedAt: null,
    awardId: null,
    ...o,
  });
  const TENDER = { id: "t-valid", workId: "11111111-1111-4111-8111-111111111111", workNumber: "WRK-1", status: "open" };

  it("Lowest Bid is the lowest eligible quote: [null,'500000','300000'] -> ₹3,000.00 (DETAIL-04)", async () => {
    mockFetches(
      { data: [quot({}), quot({ quotedAmountMinor: "500000" }), quot({ quotedAmountMinor: "300000" })], source: "api" },
      { data: TENDER, source: "api" },
    );
    render(<ToastProvider>{await TenderDetailPage({ params: Promise.resolve({ id: "t-valid" }) })}</ToastProvider>);
    expect(screen.getByText("Lowest Bid").parentElement!.textContent).toContain("₹3,000.00");
  });

  it("a withdrawn lowest quote is ignored (DETAIL-04)", async () => {
    mockFetches(
      { data: [quot({ quotedAmountMinor: "100000", status: "withdrawn" }), quot({ quotedAmountMinor: "500000" })], source: "api" },
      { data: TENDER, source: "api" },
    );
    render(<ToastProvider>{await TenderDetailPage({ params: Promise.resolve({ id: "t-valid" }) })}</ToastProvider>);
    const text = screen.getByText("Lowest Bid").parentElement!.textContent!;
    expect(text).toContain("₹5,000.00");
    expect(text).not.toContain("₹1,000.00");
  });

  it("all quotes ineligible -> '—' (DETAIL-04)", async () => {
    mockFetches(
      { data: [quot({ quotedAmountMinor: "100000", status: "rejected" }), quot({ method: "percentage_rate" })], source: "api" },
      { data: TENDER, source: "api" },
    );
    render(<ToastProvider>{await TenderDetailPage({ params: Promise.resolve({ id: "t-valid" }) })}</ToastProvider>);
    expect(screen.getByText("Lowest Bid").parentElement!.textContent).toContain("—");
  });

  it("an awarded tender shows an Awarded status tile, no placeholder dash tile (DETAIL-05)", async () => {
    mockFetches({ data: [quot({ awardId: "aaaaaaaa-1111-4111-8111-aaaaaaaaaaaa" })], source: "api" }, { data: TENDER, source: "api" });
    render(<ToastProvider>{await TenderDetailPage({ params: Promise.resolve({ id: "t-valid" }) })}</ToastProvider>);
    expect(screen.getByText("Tender Status").parentElement!.textContent).toMatch(/Awarded/);
  });

  it("the quotations table shows the contractor and no 8-char id prefix; the id is only a de-emphasised Technical ID (DETAIL-07)", async () => {
    const id = "abcdef12-0000-4000-8000-000000000000";
    mockFetches({ data: [quot({ id, quotedAmountMinor: "1000" })], source: "api" }, { data: TENDER, source: "api" });
    render(<ToastProvider>{await TenderDetailPage({ params: Promise.resolve({ id: "t-valid" }) })}</ToastProvider>);
    expect(screen.getAllByText("ACME").length).toBeGreaterThan(0);
    expect(screen.queryByText("abcdef12")).not.toBeInTheDocument();
    expect(screen.queryByText("abcdef12…")).not.toBeInTheDocument();
    expect(screen.getByText("Technical ID")).toBeInTheDocument();
  });
});
