import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn(), refresh: vi.fn() }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("@/lib/sync/resource", () => ({
  useSeededResource: <T,>(_key: string, initialData: T, source: "api" | "error") => ({
    data: initialData,
    provenance: source === "error" ? "error-no-data" : "live",
    offline: false,
    cachedAt: null,
  }),
}));

const rolesMock = vi.fn(() => ["grant_officer"] as string[]);
vi.mock("@/lib/auth/roleGuard", async () => {
  const actual = await vi.importActual<typeof import("@/lib/auth/roleGuard")>("@/lib/auth/roleGuard");
  return { ...actual, getSessionRoles: () => rolesMock() };
});

const getGrantUtilizationMock = vi.fn();
vi.mock("../../../_data/loaders", () => ({
  getGrantUtilization: () => getGrantUtilizationMock(),
}));

import GrantUtilizationPage from "./page";

const UC = (over: Record<string, unknown>) => ({
  id: "uc",
  ucNo: "UC-1",
  grantNo: "GR-1",
  granteeName: "G",
  amount: "100",
  periodFrom: "2026-04-01",
  periodTo: "2026-09-30",
  submittedDate: "2026-10-01",
  status: "submitted",
  ...over,
});

describe("GrantUtilizationPage", () => {
  beforeEach(() => {
    getGrantUtilizationMock.mockReset();
    rolesMock.mockReset();
    rolesMock.mockReturnValue(["grant_officer"]);
    getGrantUtilizationMock.mockResolvedValue({
      data: [UC({ id: "a", status: "validated" }), UC({ id: "b", status: "verified" }), UC({ id: "c", status: "submitted" })],
      source: "api",
    });
  });

  // GAP-GRANTS-UTILIZATION-06
  it("uses the en-IN spelling 'Utilisation Certificates'", async () => {
    render(await GrantUtilizationPage());
    expect(screen.getByRole("heading", { level: 1, name: "Utilisation Certificates" })).toBeInTheDocument();
    expect(screen.queryByText("Utilization Certificates")).not.toBeInTheDocument();
  });

  // GAP-GRANTS-UTILIZATION-02: both 'validated' and 'verified' count as Verified.
  it("counts both validated and verified under the Verified stat", async () => {
    render(await GrantUtilizationPage());
    const verifiedLabel = screen
      .getAllByText("Verified")
      .find((el) => el.classList.contains("lab") && el.closest(".stat"));
    const verifiedCard = verifiedLabel?.closest(".stat") as HTMLElement;
    expect(verifiedCard).toBeTruthy();
    expect(verifiedCard.textContent).toContain("2");
  });

  // GAP-GRANTS-UTILIZATION-01: Verify/Reject only for a checker. A non-checker
  // (grant_viewer) must see no action buttons.
  it("hides Verify/Reject for a non-checker role", async () => {
    rolesMock.mockReturnValue(["grant_viewer"]);
    render(await GrantUtilizationPage());
    expect(screen.queryByRole("button", { name: "Verify" })).not.toBeInTheDocument();
  });

  it("shows Verify for a checker role", async () => {
    rolesMock.mockReturnValue(["finance_admin"]);
    render(await GrantUtilizationPage());
    expect(screen.getAllByRole("button", { name: "Verify" }).length).toBeGreaterThan(0);
  });

  // GAP-GRANTS-UTILIZATION-05: a failed load shows '—' stats, not zeros.
  it("renders '—' stat cards on a failed load", async () => {
    getGrantUtilizationMock.mockResolvedValue({ data: [], source: "error" });
    render(await GrantUtilizationPage());
    const totalCard = screen.getByText("Total").closest(".stat") as HTMLElement;
    expect(totalCard.textContent).toContain("—");
  });
});
