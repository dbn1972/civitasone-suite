import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

const refreshMock = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn(), refresh: refreshMock }) }));
const seeded = vi.fn();
vi.mock("@/lib/sync/resource", () => ({ useSeededResource: (...a: unknown[]) => seeded(...a) }));

import { EntitlementsTable } from "./EntitlementsTable";

const ROWS = [
  { module: "hrms", edition: "psu", tenant: "t1", limit: "100", used: 100, status: "active" },
  { module: "finance", edition: "psu", tenant: "t2", limit: "unlimited", used: 5, status: "revoked" },
  { module: "crm", edition: "state", tenant: "t3", limit: "10", used: 1, status: "expired" },
];

function statValue(label: string) {
  return (screen.getAllByText(label).find((e) => e.classList.contains("lab")) as HTMLElement).parentElement as HTMLElement;
}

describe("EntitlementsTable", () => {
  beforeEach(() => { refreshMock.mockReset(); seeded.mockReset(); });

  // GAP-ADMIN-ENTITLEMENTS-02
  it("cached rows with an empty server prop: the cards agree with the table, not 0", () => {
    seeded.mockReturnValue({ data: ROWS, provenance: "cached", offline: false, cachedAt: "2026-10-01T10:00:00.000Z" });
    render(<EntitlementsTable entitlements={[]} source="error" />);
    expect(statValue("Total Entitlements")).toHaveTextContent("3");
    expect(statValue("Active")).toHaveTextContent("1");
    expect(statValue("Revoked")).toHaveTextContent("1");
    expect(statValue("Other inactive")).toHaveTextContent("1");
    expect(statValue("Editions")).toHaveTextContent("2");
    expect(statValue("At / over limit")).toHaveTextContent("1");
    expect(screen.getByText("hrms")).toBeInTheDocument();
  });

  // GAP-ADMIN-ENTITLEMENTS-03
  it("error with nothing cached: alert with Retry, em-dash cards, no 'No entitlements' text", () => {
    seeded.mockReturnValue({ data: [], provenance: "error-no-data", offline: false, cachedAt: null });
    render(<EntitlementsTable entitlements={[]} source="error" />);
    expect(screen.getByRole("alert")).toBeInTheDocument();
    expect(screen.queryByText(/No entitlements/)).not.toBeInTheDocument();
    for (const l of ["Total Entitlements", "Active", "Revoked", "Other inactive", "Editions", "At / over limit"]) {
      expect(statValue(l)).toHaveTextContent("—");
    }
    fireEvent.click(screen.getByRole("button", { name: "Try again" }));
    expect(refreshMock).toHaveBeenCalledTimes(1);
  });

  it("a legitimately empty successful response still shows the empty state and real zeros", () => {
    seeded.mockReturnValue({ data: [], provenance: "live", offline: false, cachedAt: null });
    render(<EntitlementsTable entitlements={[]} source="api" />);
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
    expect(screen.getByText("No entitlements configured.")).toBeInTheDocument();
    expect(statValue("Total Entitlements")).toHaveTextContent("0");
  });

  // GAP-ADMIN-ENTITLEMENTS-04
  it("shows an Over limit pill (text) for a row at its cap, none for unlimited", () => {
    seeded.mockReturnValue({ data: ROWS, provenance: "live", offline: false, cachedAt: null });
    render(<EntitlementsTable entitlements={ROWS} source="api" />);
    expect(screen.getAllByText("Over limit")).toHaveLength(1);
    expect(screen.getByRole("heading", { name: "Entitlements" })).toBeInTheDocument();
    expect(screen.queryByText("Entitlement Matrix")).not.toBeInTheDocument();
  });

  it("a permanently missing route says 'Not available yet' with no Retry", () => {
    seeded.mockReturnValue({ data: [], provenance: "error-no-data", offline: false, cachedAt: null });
    render(<EntitlementsTable entitlements={[]} source="error" unavailable />);
    expect(screen.getByText("Not available yet")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Try again" })).not.toBeInTheDocument();
  });
});
