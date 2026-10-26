import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@/test-utils/intl-render";

const getPlansDataMock = vi.fn();
vi.mock("@/app/_data/loaders", () => ({ getPlansData: (...a: unknown[]) => getPlansDataMock(...a) }));
vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: (_k: string, seed: unknown) => ({ data: seed, provenance: "live", offline: false, cachedAt: null }),
}));

import PlansPage from "./page";

const DATA = {
  currentPlanId: "psu",
  trialDaysLeft: null,
  plans: [
    { id: "govt", name: "Govt Department", pricePerMonth: 9999900, maxUsers: 10000, storageGb: 2000, maxApiCalls: 500000, modules: ["finance"] },
    { id: "psu", name: "PSU", pricePerMonth: 4999900, maxUsers: 2000, storageGb: 500, maxApiCalls: 100000, modules: ["finance"] },
  ],
  invoices: [],
};

describe("PlansPage — single source for the current plan (GAP-TENANT-ADMIN-PLANS-03)", () => {
  beforeEach(() => getPlansDataMock.mockReset());

  it("the header 'Current Plan' tile and the highlighted plan card name the same plan", async () => {
    getPlansDataMock.mockResolvedValue({ data: DATA, source: "api" });
    render(await PlansPage());
    const tile = screen.getAllByText("Current Plan").map((el) => el.closest(".stat")).find((el) => el !== null) as HTMLElement;
    expect(tile).toHaveTextContent("PSU");
    // The card carrying the "Current Plan" badge is the PSU card, and only one card carries it.
    const badges = screen.getAllByText("Current Plan").filter((el) => el.closest(".stat") === null && el.tagName === "SPAN");
    expect(badges).toHaveLength(1);
    expect(badges[0].closest(".card")).toHaveTextContent("PSU");
  });

  it("shows '—' for the current plan when the loader found no matching plan", async () => {
    getPlansDataMock.mockResolvedValue({ data: { ...DATA, currentPlanId: "ghost" }, source: "api" });
    render(await PlansPage());
    const tile = screen.getAllByText("Current Plan").map((el) => el.closest(".stat")).find((el) => el !== null) as HTMLElement;
    expect(tile).toHaveTextContent("—");
  });
});
