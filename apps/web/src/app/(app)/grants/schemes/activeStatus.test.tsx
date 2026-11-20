import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

// Regression: grant-service creates every scheme as status "active" (DB CHECK
// draft|active|closed|suspended) while the web only recognised "open", so the
// list showed "Unknown", Open=0, Apply was always disabled and Close never showed.

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
  notFound: () => {
    throw new Error("NEXT_NOT_FOUND");
  },
}));
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => ["grant_officer"] };
});

const getGrantSchemesMock = vi.fn();
const getSchemeByIdMock = vi.fn();
vi.mock("../_data", () => ({
  getGrantSchemes: () => getGrantSchemesMock(),
  getSchemeById: (id: string) => getSchemeByIdMock(id),
}));

import GrantSchemesPage from "./page";
import SchemeDetailPage from "./[id]/page";
import { isAcceptingApplications } from "../schemeWindow";

const ACTIVE = {
  id: "scheme-1",
  code: "PM-KISAN-2026",
  name: "PM Farmer Support Scheme",
  budgetMinor: 100000000,
  disbursedMinor: 0,
  minAmountMinor: 0,
  maxAmountMinor: 500000,
  currency: "INR",
  status: "active",
  openAt: "2020-04-01",
  closeAt: "2099-03-31",
  applicationCount: 0,
};

describe("grant scheme status \"active\" (grant-service vocabulary)", () => {
  beforeEach(() => {
    getGrantSchemesMock.mockReset();
    getSchemeByIdMock.mockReset();
  });

  it("list: counts an active scheme as Open and does not label it Unknown", async () => {
    getGrantSchemesMock.mockResolvedValue({ data: [ACTIVE], source: "api", droppedCount: 0 });
    render(await GrantSchemesPage());
    expect(screen.queryByText(/unknown/i)).not.toBeInTheDocument();
    expect(screen.getByText("Open").parentElement?.textContent).toMatch(/1/);
  });

  it("detail: Apply is enabled and Close Scheme is offered for an active scheme in its window", async () => {
    getSchemeByIdMock.mockResolvedValue({ data: ACTIVE, source: "api" });
    render(await SchemeDetailPage({ params: Promise.resolve({ id: "scheme-1" }) }));
    expect(screen.getByRole("link", { name: "+ New Application" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Close Scheme" })).toBeInTheDocument();
  });

  it("detail: a closed or suspended scheme still does not accept applications", async () => {
    for (const status of ["closed", "suspended"]) {
      getSchemeByIdMock.mockResolvedValue({ data: { ...ACTIVE, status }, source: "api" });
      const { unmount } = render(await SchemeDetailPage({ params: Promise.resolve({ id: "scheme-1" }) }));
      expect(screen.queryByRole("link", { name: "+ New Application" })).not.toBeInTheDocument();
      unmount();
    }
  });

  it("window: active respects openAt/closeAt", () => {
    const now = new Date("2026-06-01");
    expect(isAcceptingApplications({ status: "active", openAt: "2026-01-01", closeAt: "2026-12-31" }, now)).toBe(true);
    expect(isAcceptingApplications({ status: "active", closeAt: "2026-01-01" }, now)).toBe(false);
    expect(isAcceptingApplications({ status: "suspended" }, now)).toBe(false);
  });
});
