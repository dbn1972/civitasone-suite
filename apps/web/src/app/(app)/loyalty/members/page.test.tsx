/**
 * GAP-LOYALTY-MEMBERS-04: URL-driven server pager — next/prev links update
 * via ?page=, "Showing x–y of n" displays when total is known, and the loader
 * correctly passes limit/offset so the server returns the right page.
 */
import { describe, it, expect, vi, beforeEach } from "vitest";
import type { ReactElement } from "react";
import { render as rtlRender, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

function render(ui: ReactElement) {
  return rtlRender(<NextIntlClientProvider locale="en" messages={enMessages}>{ui}</NextIntlClientProvider>);
}

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: vi.fn() }));
import { useSeededResource } from "@/lib/sync/resource";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));

import Page from "./page";
import type { LoyaltyMemberRow } from "../_data";

const mockedHook = vi.mocked(useSeededResource);

function makeRows(n: number): LoyaltyMemberRow[] {
  return Array.from({ length: n }, (_, i) => ({
    id: `enr-${i}`,
    profileRef: "ab12cd34",
    programId: `pr-0000-${i}`,
    status: "active",
    tier: "base",
    pointsBalance: "100",
    lifetimePoints: "200",
    enrolledAt: "2026-01-01T00:00:00.000Z",
    updatedAt: "2026-01-01T00:00:00.000Z",
  }));
}

beforeEach(() => {
  fetchJsonMock.mockReset();
  mockedHook.mockReturnValue({
    data: [] as LoyaltyMemberRow[],
    provenance: "live",
    offline: false,
    cachedAt: null,
  } as never);
});

describe("loyalty members page (GAP-LOYALTY-MEMBERS-04)", () => {
  it("Given page 1 of 120 results, shows Showing 1–50 of 120 and a Next link", async () => {
    const rows = makeRows(50);
    fetchJsonMock.mockResolvedValue({ data: { rows, total: 120 }, source: "api" });
    mockedHook.mockReturnValue({ data: rows, provenance: "live", offline: false, cachedAt: null } as never);

    render(await Page({}));

    expect(screen.getByText(/Showing 1–50 of 120/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Next/ })).toHaveAttribute("href", "/loyalty/members?page=2");
    expect(screen.queryByRole("link", { name: /Previous/ })).not.toBeInTheDocument();
  });

  it("Given page 2 of 120 results, shows Showing 51–100 of 120 and both pager links", async () => {
    const rows = makeRows(50);
    fetchJsonMock.mockResolvedValue({ data: { rows, total: 120 }, source: "api" });
    mockedHook.mockReturnValue({ data: rows, provenance: "live", offline: false, cachedAt: null } as never);

    render(await Page({ searchParams: Promise.resolve({ page: "2" }) }));

    expect(screen.getByText(/Showing 51–100 of 120/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Next/ })).toHaveAttribute("href", "/loyalty/members?page=3");
    expect(screen.getByRole("link", { name: /Previous/ })).toHaveAttribute("href", "/loyalty/members?page=1");
  });

  it("Given last page (page 3, 20 rows), shows Showing 101–120 and only Previous", async () => {
    const rows = makeRows(20);
    fetchJsonMock.mockResolvedValue({ data: { rows, total: 120 }, source: "api" });
    mockedHook.mockReturnValue({ data: rows, provenance: "live", offline: false, cachedAt: null } as never);

    render(await Page({ searchParams: Promise.resolve({ page: "3" }) }));

    expect(screen.getByText(/Showing 101–120 of 120/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Next/ })).not.toBeInTheDocument();
    expect(screen.getByRole("link", { name: /Previous/ })).toHaveAttribute("href", "/loyalty/members?page=2");
  });

  it("On API error, no count shown and no pager (rows empty, total null)", async () => {
    fetchJsonMock.mockResolvedValue({ data: { rows: [], total: null }, source: "error", status: 503 });
    mockedHook.mockReturnValue({ data: [], provenance: "error-no-data", offline: false, cachedAt: null } as never);

    render(await Page({}));

    expect(screen.queryByText(/Showing/)).not.toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /Next/ })).not.toBeInTheDocument();
  });

  it("loader passes page and limit/offset to the API via qs", async () => {
    fetchJsonMock.mockResolvedValue({ data: { rows: makeRows(10), total: 60 }, source: "api" });
    mockedHook.mockReturnValue({ data: makeRows(10), provenance: "live", offline: false, cachedAt: null } as never);

    render(await Page({ searchParams: Promise.resolve({ page: "2" }) }));

    // fetchJson was called; its first arg should contain offset=50 and limit=50
    const url = String(fetchJsonMock.mock.calls[0]![0]);
    expect(url).toContain("limit=50");
    expect(url).toContain("offset=50");
  });
});
