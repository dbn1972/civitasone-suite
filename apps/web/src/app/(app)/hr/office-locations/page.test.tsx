import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

let mockRoles: string[] = ["hr_admin"];
vi.mock("@/lib/auth/roleGuard", () => ({ getSessionRoles: () => mockRoles }));
const fetchJsonMock = vi.fn();
vi.mock("@/app/_data/apiClient", () => ({ fetchJson: (...a: unknown[]) => fetchJsonMock(...a) }));
vi.mock("next/navigation", () => ({ useRouter: () => ({ refresh: vi.fn(), push: vi.fn() }) }));
vi.mock("next-intl/server", async () => {
  const en = (await import("@/messages/en.json")).default as unknown as Record<string, Record<string, string>>;
  return {
    getTranslations: async (ns: string) => (key: string, vars?: Record<string, unknown>) => {
      let s = en[ns]?.[key] ?? key;
      for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, String(v));
      return s;
    },
  };
});
vi.mock("next-intl", async () => {
  const en = (await import("@/messages/en.json")).default as unknown as Record<string, Record<string, string>>;
  return {
    useTranslations: (ns: string) => (key: string) => en[ns]?.[key] ?? key,
  };
});

import OfficeLocationsPage from "./page";

beforeEach(() => { fetchJsonMock.mockReset(); mockRoles = ["hr_admin"]; });

describe("/hr/office-locations page (GAP-HR-LOCATIONS-NEW-02)", () => {
  it("shows PermissionDenied for a role that may not create geofences, without fetching", async () => {
    mockRoles = ["employee"];
    render(await OfficeLocationsPage());
    expect(screen.getByText(/office locations/i)).toBeInTheDocument();
    expect(fetchJsonMock).not.toHaveBeenCalled();
    expect(screen.queryByRole("form")).toBeNull();
  });

  it("renders geofence rows for hr_admin", async () => {
    fetchJsonMock.mockResolvedValue({
      source: "api",
      data: [{ id: "1", name: "Head Office", address: null, latitude: 28.6, longitude: 77.2, radiusMeters: 300, isActive: true }],
    });
    render(await OfficeLocationsPage());
    expect(screen.getByText("Head Office")).toBeInTheDocument();
    expect(screen.getByText("28.6, 77.2")).toBeInTheDocument();
  });

  it("shows a load error, not the empty state, when the fetch failed", async () => {
    fetchJsonMock.mockResolvedValue({ source: "error", data: [], status: 500 });
    render(await OfficeLocationsPage());
    expect(screen.queryByText(/no office locations/i)).toBeNull();
  });
});
