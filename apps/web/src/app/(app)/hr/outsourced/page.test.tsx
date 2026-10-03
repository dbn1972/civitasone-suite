import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

let mockRoles: string[] = ["hr_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles }));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next-intl/server", async () => {
  const en = (await import("@/messages/en.json")).default as unknown as Record<string, Record<string, string>>;
  const fmt = (s: string, v?: Record<string, unknown>) => s.replace(/\{(\w+)\}/g, (_m, k) => String(v?.[k] ?? ""));
  return { getTranslations: async (ns: string) => (key: string, v?: Record<string, unknown>) => fmt(en[ns]?.[key] ?? key, v) };
});

import OutsourcedPage from "./page";

const CONTRACT = { id: "c1", vendorName: "SecureGuard Services", serviceCategory: "Security", contractRef: "CT-9", headcount: 12, contractStart: "2026-01-01", contractEnd: "2099-12-31", contractValueMinor: "123456700", status: "active" };
const STATS = { contracts: 1, vendors: 1, activeContracts: 1, expiringIn60Days: 0, totalHeadcount: 12 };

async function renderPage(sp?: { offset?: string }) {
  return render(<NextIntlClientProvider locale="en" messages={enMessages}>{await OutsourcedPage({ searchParams: sp })}</NextIntlClientProvider>);
}

beforeEach(() => {
  fetchJsonMock.mockReset();
  mockRoles = ["hr_admin"];
  fetchJsonMock.mockImplementation(async (_u: string, _f: unknown, o: { mapResponse: (p: unknown) => unknown }) => ({
    source: "api", data: o.mapResponse({ data: [CONTRACT], total: 1, stats: STATS }),
  }));
});

describe("/hr/outsourced (GAP-HR-OUTSOURCED-01)", () => {
  it("renders the real register: vendor, headcount, paise as rupees, and the stats", async () => {
    await renderPage();
    expect(screen.getByText("SecureGuard Services")).toBeInTheDocument();
    expect(screen.getByText("₹12,34,567.00")).toBeInTheDocument();
    expect(screen.queryByText(/not yet available/i)).not.toBeInTheDocument();
    expect(screen.getByText("Active headcount")).toBeInTheDocument();
  });

  it("denies a non-HR role without fetching", async () => {
    mockRoles = ["employee"];
    await renderPage();
    expect(fetchJsonMock).not.toHaveBeenCalled();
    expect(screen.getByRole("heading", { name: "Access restricted" })).toBeInTheDocument();
  });

  it("shows an honest error state (not an empty register) when the load fails", async () => {
    fetchJsonMock.mockResolvedValue({ source: "error", status: 500, data: { rows: [], total: 0, offset: 0, stats: STATS } });
    await renderPage();
    expect(screen.queryByText("No outsourced contracts")).not.toBeInTheDocument();
    expect(screen.queryByText("SecureGuard Services")).not.toBeInTheDocument();
  });
});
