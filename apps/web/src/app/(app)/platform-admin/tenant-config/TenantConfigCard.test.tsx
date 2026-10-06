import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import { TenantConfigCard, type TenantConfig } from "./TenantConfigCard";

function makeConfig(over: Partial<TenantConfig> = {}): TenantConfig {
  return {
    tenantId: "00000000-0000-0000-0000-000000000001",
    tenantName: "Pune Municipal Office",
    domain: "pune.gov.in",
    edition: "govt_dept",
    status: "active",
    region: "ap-south-1",
    residency: "IN",
    dbSchema: "tenant_00000001",
    keycloakRealm: "civitasone-pilot",
    licenseType: "Enterprise (Government)",
    licensedUntil: "2027-03-31",
    licensedSeats: null,
    activeSeats: null,
    storageQuotaGb: null,
    storageUsedGb: null,
    features: ["pfms_integration", "hrms", "mfa"],
    ...over,
  };
}

describe("TenantConfigCard", () => {
  beforeEach(() => vi.restoreAllMocks());

  it("never renders the old fabricated DEFAULT_CONFIG tenant", () => {
    render(<TenantConfigCard config={makeConfig()} daysLeft={200} isPlatformAdmin />);
    expect(screen.queryByText(/Government of India — Pilot Tenant/)).not.toBeInTheDocument();
    expect(screen.getByText("Pune Municipal Office")).toBeInTheDocument();
  });

  // TENANT-CONFIG-04: each copy button has a distinct accessible name.
  it("gives each copy control a distinct accessible name", () => {
    render(<TenantConfigCard config={makeConfig()} daysLeft={200} isPlatformAdmin />);
    expect(screen.getByRole("button", { name: "Copy tenant ID" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy database schema" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Copy Keycloak realm" })).toBeInTheDocument();
  });

  it("announces a successful copy in a live region", async () => {
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.assign(navigator, { clipboard: { writeText } });
    render(<TenantConfigCard config={makeConfig()} daysLeft={200} isPlatformAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "Copy tenant ID" }));
    await waitFor(() => expect(screen.getByText("tenant ID copied")).toBeInTheDocument());
    expect(writeText).toHaveBeenCalledWith("00000000-0000-0000-0000-000000000001");
  });

  it("shows a visible error when the clipboard is unavailable (insecure context)", async () => {
    Object.assign(navigator, { clipboard: undefined });
    render(<TenantConfigCard config={makeConfig()} daysLeft={200} isPlatformAdmin />);
    fireEvent.click(screen.getByRole("button", { name: "Copy tenant ID" }));
    expect(await screen.findByText(/copy failed/i)).toBeInTheDocument();
  });

  // TENANT-CONFIG-02: infra identifiers never render for a non-platform-admin.
  it("hides DB schema and Keycloak realm from a non-platform-admin", () => {
    render(<TenantConfigCard config={makeConfig()} daysLeft={200} isPlatformAdmin={false} />);
    expect(screen.queryByText("tenant_00000001")).not.toBeInTheDocument();
    expect(screen.queryByText("civitasone-pilot")).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Copy database schema" })).not.toBeInTheDocument();
  });

  // TENANT-CONFIG-05: app-standard IST date, not toLocaleDateString's "31 March".
  it("renders the licence date in the app-standard '31 Mar 2027' format", () => {
    render(<TenantConfigCard config={makeConfig()} daysLeft={200} isPlatformAdmin />);
    expect(screen.getByText("31 Mar 2027")).toBeInTheDocument();
    expect(screen.queryByText(/31 March 2027/)).not.toBeInTheDocument();
  });

  it("shows 'Expires in 10d' when 10 IST days remain", () => {
    render(<TenantConfigCard config={makeConfig()} daysLeft={10} isPlatformAdmin />);
    expect(screen.getByText("Expires in 10d")).toBeInTheDocument();
  });

  it("treats the expiry day (0 days) as a warning, not expired", () => {
    render(<TenantConfigCard config={makeConfig()} daysLeft={0} isPlatformAdmin />);
    expect(screen.getByText("Expires in 0d")).toBeInTheDocument();
    expect(screen.queryByText("Expired")).not.toBeInTheDocument();
  });

  // TENANT-CONFIG-06: feature keys render as module names.
  it("renders feature keys as readable module names", () => {
    render(<TenantConfigCard config={makeConfig()} daysLeft={200} isPlatformAdmin />);
    expect(screen.getByText("PFMS integration")).toBeInTheDocument();
    expect(screen.getByText("HRMS")).toBeInTheDocument();
    expect(screen.getByText("Multi-factor authentication")).toBeInTheDocument();
    expect(screen.queryByText("pfms integration")).not.toBeInTheDocument();
  });

  it("falls back to Title Case for an unknown feature key", () => {
    render(<TenantConfigCard config={makeConfig({ features: ["custom_module"] })} daysLeft={200} isPlatformAdmin />);
    expect(screen.getByText("Custom Module")).toBeInTheDocument();
  });

  // TENANT-CONFIG-01: never-tracked figures render honestly, not as fake numbers.
  it("shows 'Not tracked' for licence seats the platform does not track", () => {
    render(<TenantConfigCard config={makeConfig()} daysLeft={200} isPlatformAdmin />);
    expect(screen.getAllByText("Not tracked").length).toBeGreaterThan(0);
    expect(screen.queryByText("5,000")).not.toBeInTheDocument();
    expect(screen.queryByText("1,243")).not.toBeInTheDocument();
  });
});
