import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import enMessages from "@/messages/en.json";

const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({
  fetchJson: (...args: unknown[]) => fetchJsonMock(...args),
}));

const getSessionRolesMock = vi.fn(() => [] as string[]);
vi.mock("@/lib/auth/roleGuard", () => ({
  getSessionRoles: () => getSessionRolesMock(),
}));

import LocationsPage from "./page";

async function renderPage() {
  return render(
    <NextIntlClientProvider locale="en" messages={enMessages}>
      {await LocationsPage()}
    </NextIntlClientProvider>,
  );
}

describe("LocationsPage", () => {
  beforeEach(() => {
    fetchJsonMock.mockReset();
    getSessionRolesMock.mockReset().mockReturnValue([]);
  });

  it("renders locations and real stat counts on success", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "l1", name: "HQ", type: "office", city: "Delhi" }],
      source: "api",
    });
    await renderPage();
    expect(screen.getAllByText("Total Locations").length).toBeGreaterThan(0);
    expect(screen.getByText("HQ")).toBeInTheDocument();
  });

  it("links each location name to its detail page (GAP-HR-LOCATIONS-03)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "l1", name: "HQ", type: "office", city: "Delhi" }],
      source: "api",
    });
    await renderPage();
    expect(screen.getByRole("link", { name: "HQ" })).toHaveAttribute("href", "/hr/locations/l1");
  });

  it("shows the honest empty state when there genuinely are no locations", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "api" });
    await renderPage();
    expect(screen.getByText("No locations yet")).toBeInTheDocument();
  });

  it("shows an access-restricted message (no retry) on a 403, not the generic retryable error (GAP-HR-LOCATIONS-04)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [],
      source: "error",
      status: 403,
      errorMessage: "requires one of: hr_admin, hr_officer, super_admin",
    });
    await renderPage();
    expect(screen.getByText(/You don't have permission to do this\. Ask your administrator if you need access\./)).toBeInTheDocument();
    expect(screen.queryByText("No locations yet")).not.toBeInTheDocument();
    // single title, not "Locations (0)" -- the old title bug this item also fixed
    expect(screen.queryByText("Locations (0)")).not.toBeInTheDocument();
  });

  it("shows the generic retryable error on a non-403 failure, and does not double-announce it", async () => {
    fetchJsonMock.mockResolvedValue({ data: [], source: "error" });
    await renderPage();
    expect(screen.getByText("We couldn't connect.")).toBeInTheDocument();
    // DataSourceBadge must not also render on the error path (GAP-HR-LOCATIONS-04)
    expect(screen.queryByText(/showing cached|live data/i)).not.toBeInTheDocument();
  });

  it("derives State/District from a row's parentId chain when the API doesn't send them directly (GAP-HR-LOCATIONS-01)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [
        { id: "s1", name: "Karnataka", type: "state" },
        { id: "d1", name: "Bengaluru Urban", type: "district", parentId: "s1" },
        { id: "o1", name: "Ward Office 4", type: "office", parentId: "d1" },
      ],
      source: "api",
    });
    await renderPage();
    // "Bengaluru Urban" legitimately appears twice: once as its own row's
    // name, once as the office row's derived district badge -- likewise
    // "Karnataka" as its own row's name and as two rows' derived state badge.
    expect(screen.getAllByText("Bengaluru Urban").length).toBeGreaterThan(1);
    expect(screen.getAllByText("Karnataka").length).toBeGreaterThan(1);
  });

  it("shows a human label, not the raw enum, in the Type column (GAP-HR-LOCATIONS-05)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "f1", name: "Central Store", type: "facility" }],
      source: "api",
    });
    await renderPage();
    expect(screen.getByText("Facility")).toBeInTheDocument();
    expect(screen.queryByText("facility")).not.toBeInTheDocument();
  });

  it("only shows the row Archive action to a location-admin role (GAP-HR-LOCATIONS-02)", async () => {
    fetchJsonMock.mockResolvedValue({
      data: [{ id: "l1", name: "HQ", type: "office" }],
      source: "api",
    });
    getSessionRolesMock.mockReturnValue(["employee"]);
    await renderPage();
    expect(screen.queryByText("Archive")).not.toBeInTheDocument();

    getSessionRolesMock.mockReturnValue(["hr_admin"]);
    await renderPage();
    expect(screen.getAllByText("Archive").length).toBeGreaterThan(0);
  });
});
